import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import {
  AiProvider,
  AnswerEvaluationSchema,
  CardProposalSchema,
  TargetedQuizSchema,
  TargetedQuizSessionSchema,
  type AiProviderError,
  decodeTutorActionRequest,
  ResolveProposalRequestSchema,
  TutorActionResponseSchema,
  TutorContextSchema,
  TutorSessionStateSchema,
  TutorQuestionSchema,
} from "@recall/ai-core";
import { openAiProvider } from "@/lib/ai/openai";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type AuthResult =
  | {
      readonly _tag: "Authenticated";
      readonly client: SupabaseServerClient;
      readonly userId: string;
    }
  | { readonly _tag: "AuthFailure"; readonly status: 401 | 502 | 503 };

const StoredSessionSchema = Schema.Struct({
  id: Schema.String,
  area_id: Schema.String,
  area_snapshot: Schema.Unknown,
  last_quiz: Schema.Unknown,
  last_observation_id: Schema.NullOr(Schema.String),
  last_proposal_id: Schema.NullOr(Schema.String),
});
const StoredMessageSchema = Schema.Struct({
  role: Schema.String,
  kind: Schema.String,
  content: Schema.Unknown,
});
const StoredObservationSchema = Schema.Struct({ payload: Schema.Unknown });
const ProviderMeteringSchema = Schema.Struct({
  result: Schema.Unknown,
  inputTokens: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  outputTokens: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  model: Schema.String.pipe(Schema.minLength(1)),
});

type LoadedSession = {
  readonly session: typeof StoredSessionSchema.Type;
  readonly context: typeof TutorContextSchema.Type;
};
type LoadSessionResult =
  | { readonly _tag: "Loaded"; readonly value: LoadedSession }
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unavailable" };

async function requireUser(): Promise<AuthResult> {
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return { _tag: "AuthFailure", status: 503 };
  const result = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: async () => {
          const client = await createSupabaseServerClient(
            config.right.url,
            config.right.publishableKey,
          );
          const claims = await client.auth.getClaims();
          return { client, userId: claims.data?.claims?.sub ?? null };
        },
        catch: () => ({ _tag: "TutorAuthUnavailable" }) as const,
      }),
    ),
  );
  if (Either.isLeft(result)) return { _tag: "AuthFailure", status: 502 };
  return result.right.userId
    ? { _tag: "Authenticated", client: result.right.client, userId: result.right.userId }
    : { _tag: "AuthFailure", status: 401 };
}

async function loadSession(
  client: SupabaseServerClient,
  userId: string,
  sessionId: string,
): Promise<LoadSessionResult> {
  const found = await client
    .from("tutor_sessions")
    .select("id, area_id, area_snapshot, last_observation_id, last_proposal_id, last_quiz")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (found.error) return { _tag: "Unavailable" };
  if (!found.data) return { _tag: "Missing" };
  const session = Schema.decodeUnknownEither(StoredSessionSchema)(found.data);
  if (Either.isLeft(session)) return { _tag: "Unavailable" };

  const messageResult = await client
    .from("tutor_messages")
    .select("role, kind, content")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("sequence", { ascending: true });
  if (messageResult.error) return { _tag: "Unavailable" };
  const messages = Schema.decodeUnknownEither(Schema.Array(StoredMessageSchema))(
    messageResult.data ?? [],
  );
  if (Either.isLeft(messages)) return { _tag: "Unavailable" };
  const history: Array<{ role: "assistant" | "learner"; content: string }> = [];
  for (const message of messages.right) {
    if (typeof message.content !== "string") continue;
    if (message.role === "learner" && message.kind === "answer") {
      history.push({ role: "learner", content: message.content });
    } else if (
      message.role === "tutor" &&
      (message.kind === "question" || message.kind === "feedback")
    ) {
      history.push({ role: "assistant", content: message.content });
    }
  }
  const context = Schema.decodeUnknownEither(TutorContextSchema)({
    knowledgeArea: session.right.area_snapshot,
    history,
  });
  return Either.isLeft(context)
    ? { _tag: "Unavailable" }
    : { _tag: "Loaded", value: { session: session.right, context: context.right } };
}

function aiFailureResponse(error: AiProviderError): NextResponse {
  const status =
    error._tag === "AiRateLimited" ? 429 : error._tag === "AiQuotaExceeded" ? 413 : 503;
  const message =
    error._tag === "AiRefusal"
      ? "The tutor could not help with that request. Try rephrasing it."
      : error._tag === "AiRateLimited"
        ? "The tutor is busy. Try again shortly."
        : error._tag === "AiQuotaExceeded"
          ? "This learning area is too large for a single tutor request."
          : error._tag === "AiStructuredOutputError"
            ? "The tutor response could not be validated. Try again."
            : "AI tutoring is temporarily unavailable.";
  return NextResponse.json({ error: message }, { status });
}

function unavailable(): NextResponse {
  return NextResponse.json({ error: "tutor-storage-unavailable" }, { status: 502 });
}

async function runProvider(
  operation: () => Effect.Effect<unknown, AiProviderError, AiProvider>,
): Promise<Either.Either<unknown, AiProviderError>> {
  return Effect.runPromise(
    Effect.either(Effect.provideService(Effect.suspend(operation), AiProvider, openAiProvider)),
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (auth._tag === "AuthFailure") {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthenticated" : "auth-unavailable" },
      { status: auth.status },
    );
  }

  const bodyText = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: async () => request.text(),
        catch: () => ({ _tag: "TutorRequestReadError" }) as const,
      }),
    ),
  );
  if (Either.isLeft(bodyText)) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }
  if (Buffer.byteLength(bodyText.right, "utf8") > 128_000) {
    return NextResponse.json({ error: "request-too-large" }, { status: 413 });
  }
  const body = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => JSON.parse(bodyText.right) as unknown,
        catch: () => ({ _tag: "TutorRequestJsonError" }) as const,
      }),
    ),
  );
  if (Either.isLeft(body)) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }
  const action = Effect.runSync(Effect.either(decodeTutorActionRequest(body.right)));
  if (Either.isLeft(action)) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }

  const operation = action.right;
  let sessionId = operation.sessionId;
  let context: typeof TutorContextSchema.Type;
  let quizForEvaluation: typeof TargetedQuizSessionSchema.Type | null = null;
  let quizQuestion: string | null = null;
  if ((operation.action === "question" || operation.action === "targeted-quiz") && !sessionId) {
    if (!operation.context)
      return NextResponse.json({ error: "session-not-found" }, { status: 404 });
    context = operation.context;
  } else {
    if (!sessionId) return NextResponse.json({ error: "session-not-found" }, { status: 404 });
    const loaded = await loadSession(auth.client, auth.userId, sessionId);
    if (loaded._tag === "Missing") {
      return NextResponse.json({ error: "session-not-found" }, { status: 404 });
    }
    if (loaded._tag === "Unavailable") return unavailable();
    if (
      operation.action === "question" &&
      operation.context.knowledgeArea.id !== loaded.value.session.area_id
    ) {
      return NextResponse.json({ error: "session-area-mismatch" }, { status: 409 });
    }
    context = loaded.value.context;
    if (
      operation.action === "targeted-quiz" &&
      !context.knowledgeArea.objectives.some((objective) => objective.id === operation.objectiveId)
    ) {
      return NextResponse.json({ error: "unknown-objective" }, { status: 400 });
    }
    if (operation.action === "evaluate-quiz-answer") {
      const decodedQuiz = Schema.decodeUnknownEither(TargetedQuizSessionSchema)(
        loaded.value.session.last_quiz,
      );
      if (Either.isLeft(decodedQuiz))
        return NextResponse.json({ error: "quiz-not-found" }, { status: 409 });
      const question = decodedQuiz.right.questions[operation.questionIndex];
      if (!question)
        return NextResponse.json({ error: "quiz-question-not-found" }, { status: 404 });
      if (question.evaluation)
        return NextResponse.json({ error: "quiz-answer-already-evaluated" }, { status: 409 });
      quizForEvaluation = decodedQuiz.right;
      quizQuestion = question.prompt;
    }
  }
  if (
    operation.action === "targeted-quiz" &&
    !context.knowledgeArea.objectives.some((objective) => objective.id === operation.objectiveId)
  ) {
    return NextResponse.json({ error: "unknown-objective" }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)
    return aiFailureResponse({ _tag: "AiProviderUnavailable" });

  const aiCallId = crypto.randomUUID();
  const reservation = await auth.client.rpc("reserve_tutor_ai_call", {
    p_id: aiCallId,
    p_operation: operation.action,
    p_model: process.env.OPENAI_MODEL ?? "unconfigured",
  });
  if (reservation.error) return unavailable();
  if (reservation.data !== true)
    return NextResponse.json(
      { error: "You've reached today's tutor limit. Try again tomorrow." },
      { status: 429 },
    );

  let providerResult: Either.Either<unknown, AiProviderError>;
  if (operation.action === "question") {
    providerResult = await runProvider(() =>
      Effect.gen(function* () {
        const provider = yield* AiProvider;
        return yield* provider.generateQuestion(context);
      }),
    );
  } else if (operation.action === "evaluate") {
    providerResult = await runProvider(() =>
      Effect.gen(function* () {
        const provider = yield* AiProvider;
        return yield* provider.evaluateAnswer({ ...context, answer: operation.answer });
      }),
    );
  } else if (operation.action === "targeted-quiz") {
    providerResult = await runProvider(() =>
      Effect.gen(function* () {
        const provider = yield* AiProvider;
        return yield* provider.generateTargetedQuiz({
          ...context,
          objectiveId: operation.objectiveId,
        });
      }),
    );
  } else if (operation.action === "evaluate-quiz-answer") {
    if (!quizForEvaluation || !quizQuestion)
      return NextResponse.json({ error: "quiz-not-found" }, { status: 409 });
    providerResult = await runProvider(() =>
      Effect.gen(function* () {
        const provider = yield* AiProvider;
        return yield* provider.evaluateAnswer({
          ...context,
          history: [
            ...context.history,
            { role: "assistant", content: quizQuestion },
            {
              role: "assistant",
              content: `Use this expected answer as evaluation guidance: ${quizForEvaluation.questions[operation.questionIndex]?.expectedAnswer ?? ""}`,
            },
          ],
          answer: operation.answer,
        });
      }),
    );
  } else {
    const observationResult = await auth.client
      .from("ai_observations")
      .select("payload")
      .eq("session_id", operation.sessionId)
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (observationResult.error) return unavailable();
    if (!observationResult.data) {
      return NextResponse.json({ error: "observation-not-found" }, { status: 409 });
    }
    const storedObservation = Schema.decodeUnknownEither(StoredObservationSchema)(
      observationResult.data,
    );
    if (Either.isLeft(storedObservation)) return unavailable();
    const observation = Schema.decodeUnknownEither(AnswerEvaluationSchema)(
      storedObservation.right.payload,
    );
    if (Either.isLeft(observation)) return unavailable();
    if (observation.right.suggestedAction !== "propose-card") {
      return NextResponse.json({ error: "proposal-not-recommended" }, { status: 409 });
    }
    providerResult = await runProvider(() =>
      Effect.gen(function* () {
        const provider = yield* AiProvider;
        return yield* provider.proposeCard({ ...context, observation: observation.right });
      }),
    );
  }
  if (Either.isLeft(providerResult)) return aiFailureResponse(providerResult.left);

  const decodedMetering = Schema.decodeUnknownEither(ProviderMeteringSchema)(providerResult.right);
  if (Either.isLeft(decodedMetering))
    return NextResponse.json({ error: "invalid-provider-response" }, { status: 502 });
  const metered = decodedMetering.right;
  if (metered.inputTokens !== null && metered.outputTokens !== null) {
    const recorded = await auth.client.rpc("record_tutor_ai_usage", {
      p_id: aiCallId,
      p_input_tokens: metered.inputTokens,
      p_output_tokens: metered.outputTokens,
    });
    if (recorded.error || recorded.data !== true) return unavailable();
  }

  let response: unknown;
  if (operation.action === "question") {
    const decoded = Schema.decodeUnknownEither(TutorQuestionSchema)(metered.result);
    if (Either.isLeft(decoded))
      return NextResponse.json({ error: "invalid-provider-response" }, { status: 502 });
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      const savedSession = await auth.client.from("tutor_sessions").insert({
        id: sessionId,
        user_id: auth.userId,
        area_id: operation.context.knowledgeArea.id,
        area_title: operation.context.knowledgeArea.title,
        area_snapshot: operation.context.knowledgeArea,
      });
      if (savedSession.error) return unavailable();
    }
    const savedMessage = await auth.client.from("tutor_messages").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      user_id: auth.userId,
      role: "tutor",
      kind: "question",
      content: decoded.right.question,
    });
    if (savedMessage.error) return unavailable();
    const updatedSession = await auth.client
      .from("tutor_sessions")
      .update({
        updated_at: new Date().toISOString(),
        last_observation_id: null,
        last_proposal_id: null,
        last_quiz: null,
      })
      .eq("id", sessionId)
      .eq("user_id", auth.userId);
    if (updatedSession.error) return unavailable();
    response = { action: "question", sessionId, result: decoded.right };
  } else if (operation.action === "evaluate") {
    const decoded = Schema.decodeUnknownEither(AnswerEvaluationSchema)(metered.result);
    if (Either.isLeft(decoded))
      return NextResponse.json({ error: "invalid-provider-response" }, { status: 502 });
    const observationId = crypto.randomUUID();
    const answerMessage = await auth.client.from("tutor_messages").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      user_id: auth.userId,
      role: "learner",
      kind: "answer",
      content: operation.answer,
    });
    if (answerMessage.error) return unavailable();
    const feedbackMessage = await auth.client.from("tutor_messages").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      user_id: auth.userId,
      role: "tutor",
      kind: "feedback",
      content: decoded.right.feedback,
    });
    if (feedbackMessage.error) return unavailable();
    const observation = await auth.client.from("ai_observations").insert({
      id: observationId,
      session_id: sessionId,
      user_id: auth.userId,
      objective_id: decoded.right.objectiveId,
      result: decoded.right.result,
      confidence: decoded.right.confidence,
      misconception: decoded.right.misconception,
      evidence_summary: decoded.right.feedback,
      suggested_action: decoded.right.suggestedAction,
      payload: decoded.right,
    });
    if (observation.error) return unavailable();
    const updatedSession = await auth.client
      .from("tutor_sessions")
      .update({
        updated_at: new Date().toISOString(),
        last_observation_id: observationId,
        last_proposal_id: null,
        last_quiz: null,
      })
      .eq("id", sessionId)
      .eq("user_id", auth.userId);
    if (updatedSession.error) return unavailable();
    response = { action: "evaluate", sessionId, result: decoded.right };
  } else if (operation.action === "targeted-quiz") {
    const decoded = Schema.decodeUnknownEither(TargetedQuizSchema)(metered.result);
    const objective = context.knowledgeArea.objectives.find(
      (item) => item.id === operation.objectiveId,
    );
    if (Either.isLeft(decoded) || !objective || decoded.right.objectiveId !== objective.id)
      return NextResponse.json({ error: "invalid-provider-response" }, { status: 502 });
    const quiz = { ...decoded.right, objectiveTitle: objective.title };
    const sessionQuiz = {
      ...quiz,
      questions: quiz.questions.map((question) => ({
        ...question,
        learnerAnswer: null,
        evaluation: null,
      })),
    };
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      const savedSession = await auth.client.from("tutor_sessions").insert({
        id: sessionId,
        user_id: auth.userId,
        area_id: context.knowledgeArea.id,
        area_title: context.knowledgeArea.title,
        area_snapshot: context.knowledgeArea,
      });
      if (savedSession.error) return unavailable();
    }
    const updatedSession = await auth.client
      .from("tutor_sessions")
      .update({ last_quiz: sessionQuiz, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("user_id", auth.userId);
    if (updatedSession.error) return unavailable();
    response = { action: "targeted-quiz", sessionId, result: quiz };
  } else if (operation.action === "evaluate-quiz-answer") {
    if (!quizForEvaluation) return NextResponse.json({ error: "quiz-not-found" }, { status: 409 });
    const decoded = Schema.decodeUnknownEither(AnswerEvaluationSchema)(metered.result);
    if (Either.isLeft(decoded))
      return NextResponse.json({ error: "invalid-provider-response" }, { status: 502 });
    const evaluation = {
      ...decoded.right,
      objectiveId: quizForEvaluation.objectiveId,
    };
    const validatedEvaluation = Schema.decodeUnknownEither(AnswerEvaluationSchema)(evaluation);
    if (Either.isLeft(validatedEvaluation))
      return NextResponse.json({ error: "invalid-provider-response" }, { status: 502 });
    const questionIndex = operation.questionIndex;
    const updatedQuiz = {
      ...quizForEvaluation,
      questions: quizForEvaluation.questions.map((question, index) =>
        index === questionIndex
          ? {
              ...question,
              learnerAnswer: operation.answer,
              evaluation: validatedEvaluation.right,
            }
          : question,
      ),
    };
    const answerMessage = await auth.client.from("tutor_messages").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      user_id: auth.userId,
      role: "learner",
      kind: "answer",
      content: operation.answer,
    });
    if (answerMessage.error) return unavailable();
    const feedbackMessage = await auth.client.from("tutor_messages").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      user_id: auth.userId,
      role: "tutor",
      kind: "feedback",
      content: validatedEvaluation.right.feedback,
    });
    if (feedbackMessage.error) return unavailable();
    const observationId = crypto.randomUUID();
    const observation = await auth.client.from("ai_observations").insert({
      id: observationId,
      session_id: sessionId,
      user_id: auth.userId,
      objective_id: quizForEvaluation.objectiveId,
      result: validatedEvaluation.right.result,
      confidence: validatedEvaluation.right.confidence,
      misconception: validatedEvaluation.right.misconception,
      evidence_summary: validatedEvaluation.right.feedback,
      suggested_action: validatedEvaluation.right.suggestedAction,
      payload: validatedEvaluation.right,
    });
    if (observation.error) return unavailable();
    const updatedSession = await auth.client
      .from("tutor_sessions")
      .update({
        last_observation_id: observationId,
        last_proposal_id: null,
        last_quiz: updatedQuiz,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("user_id", auth.userId);
    if (updatedSession.error) return unavailable();
    response = {
      action: "evaluate-quiz-answer",
      sessionId,
      questionIndex,
      result: validatedEvaluation.right,
      quiz: updatedQuiz,
    };
  } else {
    const decoded = Schema.decodeUnknownEither(CardProposalSchema)(metered.result);
    if (Either.isLeft(decoded))
      return NextResponse.json({ error: "invalid-provider-response" }, { status: 502 });
    const latestObservation = await auth.client
      .from("ai_observations")
      .select("id")
      .eq("session_id", sessionId)
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestObservation.error || !latestObservation.data) return unavailable();
    const proposalId = crypto.randomUUID();
    const savedProposal = await auth.client.from("generated_card_proposals").insert({
      id: proposalId,
      session_id: sessionId,
      observation_id: latestObservation.data.id,
      user_id: auth.userId,
      content: decoded.right,
      state: "pending",
    });
    if (savedProposal.error) return unavailable();
    const updatedSession = await auth.client
      .from("tutor_sessions")
      .update({ last_proposal_id: proposalId, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("user_id", auth.userId);
    if (updatedSession.error) return unavailable();
    const savedMessage = await auth.client.from("tutor_messages").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      user_id: auth.userId,
      role: "tutor",
      kind: "proposal",
      content: decoded.right.front,
    });
    if (savedMessage.error) return unavailable();
    response = { action: "propose-card", sessionId, proposalId, result: decoded.right };
  }

  const validated = Schema.decodeUnknownEither(TutorActionResponseSchema)(response);
  if (Either.isLeft(validated))
    return NextResponse.json({ error: "invalid-provider-response" }, { status: 502 });
  return NextResponse.json(validated.right);
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (auth._tag === "AuthFailure") {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthenticated" : "auth-unavailable" },
      { status: auth.status },
    );
  }
  const body = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: async () => (await request.json()) as unknown,
        catch: () => ({ _tag: "ProposalRequestReadError" }) as const,
      }),
    ),
  );
  if (Either.isLeft(body)) return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  const decoded = Schema.decodeUnknownEither(ResolveProposalRequestSchema)(body.right);
  if (Either.isLeft(decoded))
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  if (decoded.right.state === "approved" && !decoded.right.cardId)
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  const result = await auth.client.rpc("resolve_card_proposal", {
    p_proposal_id: decoded.right.proposalId,
    p_state: decoded.right.state,
    p_content: decoded.right.state === "approved" ? (decoded.right.content ?? null) : null,
    p_card_id: decoded.right.state === "approved" ? (decoded.right.cardId ?? null) : null,
  });
  if (result.error) return unavailable();
  if (!result.data) return NextResponse.json({ error: "proposal-not-pending" }, { status: 409 });
  return NextResponse.json({ proposalId: decoded.right.proposalId, state: decoded.right.state });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (auth._tag === "AuthFailure") {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthenticated" : "auth-unavailable" },
      { status: auth.status },
    );
  }
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (
    !sessionId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
  ) {
    return NextResponse.json({ error: "invalid-session-id" }, { status: 400 });
  }
  const loaded = await loadSession(auth.client, auth.userId, sessionId);
  if (loaded._tag === "Missing") {
    return NextResponse.json({ error: "session-not-found" }, { status: 404 });
  }
  if (loaded._tag === "Unavailable") return unavailable();

  let evaluation: typeof AnswerEvaluationSchema.Type | null = null;
  const observationId = loaded.value.session.last_observation_id;
  if (observationId) {
    const result = await auth.client
      .from("ai_observations")
      .select("payload")
      .eq("id", observationId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (result.error || !result.data) return unavailable();
    const stored = Schema.decodeUnknownEither(StoredObservationSchema)(result.data);
    if (Either.isLeft(stored)) return unavailable();
    const decoded = Schema.decodeUnknownEither(AnswerEvaluationSchema)(stored.right.payload);
    if (Either.isLeft(decoded)) return unavailable();
    evaluation = decoded.right;
  }

  let proposal: {
    readonly proposalId: string;
    readonly content: typeof CardProposalSchema.Type;
  } | null = null;
  const proposalId = loaded.value.session.last_proposal_id;
  if (proposalId) {
    const result = await auth.client
      .from("generated_card_proposals")
      .select("id, content, state")
      .eq("id", proposalId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (result.error || !result.data) return unavailable();
    if (result.data.state === "pending") {
      const content = Schema.decodeUnknownEither(CardProposalSchema)(result.data.content);
      if (Either.isLeft(content)) return unavailable();
      proposal = { proposalId, content: content.right };
    }
  }

  let quiz: typeof TargetedQuizSessionSchema.Type | null = null;
  if (loaded.value.session.last_quiz !== null) {
    const decodedQuiz = Schema.decodeUnknownEither(TargetedQuizSessionSchema)(
      loaded.value.session.last_quiz,
    );
    if (Either.isLeft(decodedQuiz)) return unavailable();
    quiz = decodedQuiz.right;
  }
  const state = Schema.decodeUnknownEither(TutorSessionStateSchema)({
    sessionId,
    history: loaded.value.context.history,
    evaluation,
    proposal,
    quiz,
  });
  return Either.isLeft(state)
    ? NextResponse.json({ error: "tutor-state-invalid" }, { status: 502 })
    : NextResponse.json(state.right);
}
