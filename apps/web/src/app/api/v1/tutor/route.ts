import { observeRoute } from "@/lib/http/observe-route";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import {
  AnswerEvaluationSchema,
  CardProposalSchema,
  TargetedQuizSessionSchema,
  type AiProviderError,
  decodeTutorActionRequest,
  ResolveTutorProposalRequestSchema,
  ResolveTutorProposalResponseSchema,
  TutorApiRequestSchema,
  TutorApiResponseSchema,
  TutorActionResponseSchema,
  TutorSessionStateResponseSchema,
  TutorSessionStateSchema,
} from "@recall/ai-core";
import {
  prepareTutorWorkflow,
  executeTutorWorkflow,
  validateTutorProposalResolution,
  type TutorWorkflowFailure,
  type TutorWorkflowSnapshot,
  tutorAreaFingerprint,
} from "@recall/application";
import { TutorSessionQuerySchema } from "@recall/contracts";
import { hostedTutorModel, createHostedTutorProvider } from "@/lib/ai/openai";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { readJsonBody } from "@/lib/http/read-json";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createTutorApprovalAdmin } from "@/lib/supabase/tutor-approval-admin";
import {
  loadTutorSession,
  readTutorObservationPayload,
  readTutorObservationHistory,
  readTutorProposal,
  readTutorCanonicalArea,
} from "@recall/infra-supabase/tutor-repository";
import { toDatabaseJson } from "@recall/infra-supabase/json";
import {
  appendTutorMessage,
  appendTutorObservation,
  appendTutorProposal,
  createTutorSession,
  recordTutorUsage,
  reserveTutorCall,
  resolveTutorProposal,
  linkExistingTutorApprovalRevision,
  repairTutorSessionApprovalRevisions,
  updateTutorSession,
  type TutorWriteError,
} from "@recall/infra-supabase/tutor-writes";
import type { Json } from "@recall/infra-supabase/database.types";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type AuthResult =
  | {
      readonly _tag: "Authenticated";
      readonly client: SupabaseServerClient;
      readonly userId: string;
    }
  | { readonly _tag: "AuthFailure"; readonly status: 401 | 502 | 503 };

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
          return { client, userId: claims.data?.claims.sub ?? null };
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

async function loadSession(client: SupabaseServerClient, userId: string, sessionId: string) {
  return Effect.runPromise(Effect.either(loadTutorSession(client, userId, sessionId)));
}

async function tutorWriteSucceeded(
  operation: Effect.Effect<unknown, TutorWriteError>,
): Promise<boolean> {
  return Either.isRight(await Effect.runPromise(Effect.either(operation)));
}

function aiFailureResponse(error: AiProviderError): NextResponse {
  const status =
    error._tag === "AiRateLimited" || error._tag === "AiBudgetExceeded"
      ? 429
      : error._tag === "AiContextBudgetExceeded"
        ? 413
        : 503;
  const message =
    error._tag === "AiBudgetExceeded"
      ? "You have reached today’s hosted AI budget. Try again tomorrow."
      : error._tag === "AiBudgetUnavailable"
        ? "Hosted AI budgeting is temporarily unavailable. Try again later."
        : error._tag === "AiRefusal"
          ? "The tutor could not help with that request. Try rephrasing it."
          : error._tag === "AiRateLimited"
            ? "The tutor is busy. Try again shortly."
            : error._tag === "AiContextBudgetExceeded"
              ? "Required tutor context is too large. Shorten objective descriptions or AI instructions."
              : error._tag === "AiQuotaExceeded"
                ? "The hosted AI account has exhausted its quota. Ask the operator to check API funding."
                : error._tag === "AiStructuredOutputError"
                  ? "The tutor response could not be validated. Try again."
                  : "AI tutoring is temporarily unavailable.";
  return privateJson({ error: message }, { status });
}

function unavailable(): NextResponse {
  return privateJson({ error: "tutor-storage-unavailable" }, { status: 502 });
}

function workflowFailureResponse(error: TutorWorkflowFailure): NextResponse {
  if (error.code === "context-budget-exceeded")
    return aiFailureResponse({ _tag: "AiContextBudgetExceeded" });
  const status =
    error.code === "invalid-provider-response" || error.code === "invalid-session"
      ? 502
      : error.code === "session-not-found" || error.code === "quiz-question-not-found"
        ? 404
        : error.code === "invalid-request" || error.code === "unknown-objective"
          ? 400
          : 409;
  return privateJson({ error: error.code }, { status });
}

function loadWorkflowSnapshot(client: SupabaseServerClient, userId: string, sessionId: string) {
  return Effect.gen(function* () {
    const loaded = yield* loadTutorSession(client, userId, sessionId);
    const observations = yield* readTutorObservationHistory(client, userId, sessionId);
    const decode = <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
      Schema.decodeUnknown(schema)(input).pipe(
        Effect.mapError(() => ({ _tag: "TutorSnapshotUnavailable" }) as const),
      );
    const evaluation = loaded.session.last_observation_id
      ? yield* decode(
          AnswerEvaluationSchema,
          yield* readTutorObservationPayload(client, userId, loaded.session.last_observation_id),
        )
      : null;
    const quiz =
      loaded.session.last_quiz === null
        ? null
        : yield* decode(TargetedQuizSessionSchema, loaded.session.last_quiz);
    let proposal: TutorWorkflowSnapshot["state"]["proposal"] = null;
    if (loaded.session.last_proposal_id) {
      const stored = yield* readTutorProposal(client, userId, loaded.session.last_proposal_id);
      if (stored.state === "pending")
        proposal = {
          proposalId: stored.id,
          content: yield* decode(CardProposalSchema, stored.content),
        };
    }
    return {
      observationId: loaded.session.last_observation_id,
      snapshot: {
        context: loaded.context,
        pendingQuestion: loaded.pendingQuestion,
        state: {
          sessionId,
          history: loaded.context.history,
          evaluation,
          observations,
          proposal,
          quiz,
        },
      },
    };
  });
}

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (auth._tag === "AuthFailure") {
    return privateJson(
      { error: auth.status === 401 ? "unauthenticated" : "auth-unavailable" },
      { status: auth.status },
    );
  }
  const limited = await authenticatedApiRateLimit(auth.userId, "tutor-write", { request });
  if (limited) return limited;

  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 128_000)));
  if (Either.isLeft(body)) {
    return privateJson(
      { error: body.left.reason === "too-large" ? "request-too-large" : "invalid-request" },
      { status: body.left.reason === "too-large" ? 413 : 400 },
    );
  }
  const apiRequest = Schema.decodeUnknownEither(TutorApiRequestSchema)(body.right);
  if (Either.isLeft(apiRequest)) {
    return privateJson({ error: "invalid-request" }, { status: 400 });
  }
  const action = Effect.runSync(Effect.either(decodeTutorActionRequest(apiRequest.right.request)));
  if (Either.isLeft(action)) return privateJson({ error: "invalid-request" }, { status: 400 });

  let operation = action.right;
  if (
    !operation.sessionId &&
    "canonicalAreaFingerprint" in operation &&
    operation.canonicalAreaFingerprint &&
    "context" in operation &&
    operation.context
  ) {
    const canonical = await Effect.runPromise(
      Effect.either(
        readTutorCanonicalArea(auth.client, auth.userId, operation.context.knowledgeArea.id),
      ),
    );
    if (Either.isLeft(canonical)) {
      return canonical.left._tag === "TutorReadNotFound"
        ? privateJson(
            {
              error:
                "Sync this learning area before starting hosted tutoring so its full content can be saved.",
            },
            { status: 409 },
          )
        : unavailable();
    }
    if (tutorAreaFingerprint(canonical.right) !== operation.canonicalAreaFingerprint)
      return privateJson(
        { error: "Sync your latest learning area changes before starting hosted tutoring." },
        { status: 409 },
      );
    operation = { ...operation, context: { ...operation.context, knowledgeArea: canonical.right } };
  }
  let snapshot: TutorWorkflowSnapshot | null = null;
  let observationId: string | null = null;
  if (operation.sessionId) {
    const loaded = await Effect.runPromise(
      Effect.either(loadWorkflowSnapshot(auth.client, auth.userId, operation.sessionId)),
    );
    if (Either.isLeft(loaded))
      return loaded.left._tag === "TutorSessionNotFound"
        ? privateJson({ error: "session-not-found" }, { status: 404 })
        : unavailable();
    snapshot = loaded.right.snapshot;
    observationId = loaded.right.observationId;
  }
  const prepared = await Effect.runPromise(
    Effect.either(prepareTutorWorkflow(operation, snapshot, crypto.randomUUID())),
  );
  if (Either.isLeft(prepared)) return workflowFailureResponse(prepared.left);
  const model = hostedTutorModel(
    operation.action === "evaluate-quiz-answer" ? "evaluate" : operation.action,
  );
  if (!process.env.OPENAI_API_KEY || !model)
    return aiFailureResponse({ _tag: "AiProviderUnavailable" });
  const aiCallId = crypto.randomUUID();
  const provider = createHostedTutorProvider(auth.userId, aiCallId, new Date());
  if (Either.isLeft(provider)) return aiFailureResponse(provider.left);
  const reservation = await Effect.runPromise(
    Effect.either(
      reserveTutorCall(
        auth.client,
        aiCallId,
        operation.action === "study-card" ? "propose-card" : operation.action,
        model,
      ),
    ),
  );
  if (Either.isLeft(reservation)) return unavailable();
  if (!reservation.right)
    return privateJson(
      { error: "You've reached today's tutor limit. Try again tomorrow." },
      { status: 429 },
    );
  const transition = await Effect.runPromise(
    Effect.either(
      executeTutorWorkflow(prepared.right, provider.right, crypto.randomUUID(), (metering) =>
        metering.inputTokens !== null && metering.outputTokens !== null
          ? recordTutorUsage(
              auth.client,
              aiCallId,
              metering.inputTokens,
              metering.outputTokens,
            ).pipe(Effect.asVoid)
          : Effect.void,
      ),
    ),
  );
  if (Either.isLeft(transition)) {
    const error = transition.left;
    if (error._tag === "TutorWorkflowFailure") return workflowFailureResponse(error);
    if (error._tag === "TutorWriteUnavailable") return unavailable();
    return aiFailureResponse(error);
  }
  const { snapshot: next } = transition.right;
  const response =
    transition.right.response.action === "study-card"
      ? { ...transition.right.response, providerResolutionRequired: false }
      : transition.right.response;
  const sessionId = response.sessionId;
  if (prepared.right.createsSession) {
    const snapshotJson = await Effect.runPromise(
      Effect.either(toDatabaseJson(next.context.knowledgeArea)),
    );
    if (Either.isLeft(snapshotJson) || snapshotJson.right === null) return unavailable();
    if (
      !(await tutorWriteSucceeded(
        createTutorSession(auth.client, auth.userId, {
          id: sessionId,
          area_id: next.context.knowledgeArea.id,
          area_title: next.context.knowledgeArea.title,
          area_snapshot: snapshotJson.right,
        }),
      ))
    )
      return unavailable();
  }
  for (const message of transition.right.appendedHistory) {
    if (
      !(await tutorWriteSucceeded(
        appendTutorMessage(auth.client, auth.userId, {
          id: crypto.randomUUID(),
          session_id: sessionId,
          role: message.role === "assistant" ? "tutor" : "learner",
          kind:
            message.role === "learner"
              ? "answer"
              : response.action === "question"
                ? "question"
                : "feedback",
          content: message.content,
        }),
      ))
    )
      return unavailable();
  }
  if (response.action === "question") {
    if (
      !(await tutorWriteSucceeded(
        updateTutorSession(auth.client, auth.userId, sessionId, {
          updated_at: new Date().toISOString(),
          last_observation_id: null,
          last_proposal_id: null,
          last_quiz: null,
        }),
      ))
    )
      return unavailable();
  } else if (response.action === "targeted-quiz") {
    const quizJson = await Effect.runPromise(Effect.either(toDatabaseJson(next.state.quiz)));
    if (Either.isLeft(quizJson) || quizJson.right === null) return unavailable();
    if (
      !(await tutorWriteSucceeded(
        updateTutorSession(auth.client, auth.userId, sessionId, {
          updated_at: new Date().toISOString(),
          last_quiz: quizJson.right,
          last_observation_id: null,
          last_proposal_id: null,
        }),
      ))
    )
      return unavailable();
  } else if (response.action === "evaluate" || response.action === "evaluate-quiz-answer") {
    const payload = await Effect.runPromise(Effect.either(toDatabaseJson(response.result)));
    const quizJson = await Effect.runPromise(Effect.either(toDatabaseJson(next.state.quiz)));
    if (Either.isLeft(payload) || payload.right === null || Either.isLeft(quizJson))
      return unavailable();
    const newObservationId = crypto.randomUUID();
    if (
      !(await tutorWriteSucceeded(
        appendTutorObservation(auth.client, auth.userId, {
          id: newObservationId,
          session_id: sessionId,
          objective_id: response.result.objectiveId,
          result: response.result.result,
          confidence: response.result.confidence,
          misconception: response.result.misconception,
          evidence_summary: response.result.feedback,
          suggested_action: response.result.suggestedAction,
          payload: payload.right,
        }),
      ))
    )
      return unavailable();
    if (
      !(await tutorWriteSucceeded(
        updateTutorSession(auth.client, auth.userId, sessionId, {
          updated_at: new Date().toISOString(),
          last_observation_id: newObservationId,
          last_proposal_id: null,
          last_quiz: quizJson.right,
        }),
      ))
    )
      return unavailable();
  } else if (response.action === "study-card") {
    // Source proposals are approved locally. Existing SQL proposals require learner
    // observations, which source extraction must never fabricate.
  } else {
    if (!observationId) return unavailable();
    const content = await Effect.runPromise(Effect.either(toDatabaseJson(response.result)));
    if (Either.isLeft(content) || content.right === null) return unavailable();
    if (
      !(await tutorWriteSucceeded(
        appendTutorProposal(auth.client, auth.userId, {
          id: response.proposalId,
          session_id: sessionId,
          observation_id: observationId,
          content: content.right,
          state: "pending",
        }),
      )) ||
      !(await tutorWriteSucceeded(
        updateTutorSession(auth.client, auth.userId, sessionId, {
          last_proposal_id: response.proposalId,
          updated_at: new Date().toISOString(),
        }),
      )) ||
      !(await tutorWriteSucceeded(
        appendTutorMessage(auth.client, auth.userId, {
          id: crypto.randomUUID(),
          session_id: sessionId,
          role: "tutor",
          kind: "proposal",
          content: response.result.front,
        }),
      ))
    )
      return unavailable();
  }
  const validated = Schema.decodeUnknownEither(TutorActionResponseSchema)(response);
  if (Either.isLeft(validated))
    return privateJson({ error: "invalid-provider-response" }, { status: 502 });
  const apiResponse = Schema.decodeUnknownEither(TutorApiResponseSchema)({
    schemaVersion: 1,
    response: validated.right,
  });
  return Either.isLeft(apiResponse)
    ? privateJson({ error: "invalid-provider-response" }, { status: 502 })
    : privateJson(apiResponse.right);
}

async function handlePATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (auth._tag === "AuthFailure") {
    return privateJson(
      { error: auth.status === 401 ? "unauthenticated" : "auth-unavailable" },
      { status: auth.status },
    );
  }
  const limited = await authenticatedApiRateLimit(auth.userId, "tutor-write", { request });
  if (limited) return limited;
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 64_000)));
  if (Either.isLeft(body)) {
    return privateJson(
      { error: body.left.reason === "too-large" ? "request-too-large" : "invalid-request" },
      { status: body.left.reason === "too-large" ? 413 : 400 },
    );
  }
  const apiRequest = Schema.decodeUnknownEither(ResolveTutorProposalRequestSchema)(body.right);
  if (Either.isLeft(apiRequest)) return privateJson({ error: "invalid-request" }, { status: 400 });
  const decoded = await Effect.runPromise(
    Effect.either(validateTutorProposalResolution(apiRequest.right.request)),
  );
  if (Either.isLeft(decoded)) return workflowFailureResponse(decoded.left);
  let approvedCardId: string | undefined;
  let approvedContent: Exclude<Json, null> | undefined;
  if (decoded.right.state === "approved") {
    if (!decoded.right.cardId) return privateJson({ error: "invalid-request" }, { status: 400 });
    approvedCardId = decoded.right.cardId;
    if (decoded.right.content) {
      const encodedContent = await Effect.runPromise(
        Effect.either(toDatabaseJson(decoded.right.content)),
      );
      if (Either.isLeft(encodedContent) || encodedContent.right === null) return unavailable();
      approvedContent = encodedContent.right;
    }
  }
  const result = await Effect.runPromise(
    Effect.either(
      resolveTutorProposal(
        auth.client,
        decoded.right.proposalId,
        decoded.right.state,
        approvedContent,
        approvedCardId,
      ),
    ),
  );
  if (Either.isLeft(result)) return unavailable();
  if (!result.right) {
    const persisted = await Effect.runPromise(
      Effect.either(readTutorProposal(auth.client, auth.userId, decoded.right.proposalId)),
    );
    if (Either.isLeft(persisted)) {
      if (persisted.left._tag !== "TutorReadNotFound") return unavailable();
      return privateJson({ error: "proposal-not-pending" }, { status: 409 });
    }
    const stateMatches = persisted.right.state === decoded.right.state;
    const approvalMatches =
      decoded.right.state !== "approved" ||
      (persisted.right.approved_card_id === decoded.right.cardId &&
        (decoded.right.content === undefined ||
          sameProposalContent(persisted.right.content, decoded.right.content)));
    if (!stateMatches || !approvalMatches)
      return privateJson({ error: "proposal-not-pending" }, { status: 409 });
  }
  if (decoded.right.state === "approved") {
    const linked = await Effect.runPromise(
      Effect.either(
        linkExistingTutorApprovalRevision(
          auth.client,
          createTutorApprovalAdmin(),
          auth.userId,
          decoded.right.proposalId,
        ),
      ),
    );
    if (Either.isLeft(linked)) return unavailable();
  }
  const response = Schema.decodeUnknownEither(ResolveTutorProposalResponseSchema)({
    schemaVersion: 1,
    proposalId: decoded.right.proposalId,
    state: decoded.right.state,
  });
  return Either.isLeft(response)
    ? privateJson({ error: "proposal-response-invalid" }, { status: 502 })
    : privateJson(response.right);
}

function sameProposalContent(left: unknown, right: typeof CardProposalSchema.Type): boolean {
  const decoded = Schema.decodeUnknownEither(CardProposalSchema)(left);
  return (
    Either.isRight(decoded) &&
    decoded.right.front === right.front &&
    decoded.right.back === right.back &&
    decoded.right.objectiveId === right.objectiveId &&
    decoded.right.rationale === right.rationale
  );
}

async function handleGET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (auth._tag === "AuthFailure") {
    return privateJson(
      { error: auth.status === 401 ? "unauthenticated" : "auth-unavailable" },
      { status: auth.status },
    );
  }
  const limited = await authenticatedApiRateLimit(auth.userId, "tutor-read", { request });
  if (limited) return limited;
  const query = new URL(request.url).searchParams;
  const decodedQuery = Schema.decodeUnknownEither(TutorSessionQuerySchema)({
    sessionId: query.getAll("sessionId"),
  });
  if (Either.isLeft(decodedQuery)) {
    return privateJson({ error: "invalid-session-id" }, { status: 400 });
  }
  const sessionId = decodedQuery.right.sessionId[0];
  if (sessionId === undefined) {
    return privateJson({ error: "invalid-session-id" }, { status: 400 });
  }
  const loaded = await loadSession(auth.client, auth.userId, sessionId);
  if (Either.isLeft(loaded) && loaded.left._tag === "TutorSessionNotFound") {
    return privateJson({ error: "session-not-found" }, { status: 404 });
  }
  if (Either.isLeft(loaded)) return unavailable();
  const session = loaded.right;

  const repaired = await Effect.runPromise(
    Effect.either(
      repairTutorSessionApprovalRevisions(
        auth.client,
        createTutorApprovalAdmin(),
        auth.userId,
        sessionId,
      ),
    ),
  );
  if (Either.isLeft(repaired)) return unavailable();

  const observations = await Effect.runPromise(
    Effect.either(readTutorObservationHistory(auth.client, auth.userId, sessionId)),
  );
  if (Either.isLeft(observations)) return unavailable();

  let evaluation: typeof AnswerEvaluationSchema.Type | null = null;
  const observationId = session.session.last_observation_id;
  if (observationId) {
    const result = await Effect.runPromise(
      Effect.either(readTutorObservationPayload(auth.client, auth.userId, observationId)),
    );
    if (Either.isLeft(result)) return unavailable();
    const decoded = Schema.decodeUnknownEither(AnswerEvaluationSchema)(result.right);
    if (Either.isLeft(decoded)) return unavailable();
    evaluation = decoded.right;
  }

  let proposal: {
    readonly proposalId: string;
    readonly content: typeof CardProposalSchema.Type;
  } | null = null;
  const proposalId = session.session.last_proposal_id;
  if (proposalId) {
    const result = await Effect.runPromise(
      Effect.either(readTutorProposal(auth.client, auth.userId, proposalId)),
    );
    if (Either.isLeft(result)) return unavailable();
    if (result.right.state === "pending") {
      const content = Schema.decodeUnknownEither(CardProposalSchema)(result.right.content);
      if (Either.isLeft(content)) return unavailable();
      proposal = { proposalId, content: content.right };
    }
  }

  let quiz: typeof TargetedQuizSessionSchema.Type | null = null;
  if (session.session.last_quiz !== null) {
    const decodedQuiz = Schema.decodeUnknownEither(TargetedQuizSessionSchema)(
      session.session.last_quiz,
    );
    if (Either.isLeft(decodedQuiz)) return unavailable();
    quiz = decodedQuiz.right;
  }
  const state = Schema.decodeUnknownEither(TutorSessionStateSchema)({
    sessionId,
    history: session.context.history,
    evaluation,
    observations: observations.right,
    proposal,
    quiz,
  });
  if (Either.isLeft(state)) return privateJson({ error: "tutor-state-invalid" }, { status: 502 });
  const response = Schema.decodeUnknownEither(TutorSessionStateResponseSchema)({
    schemaVersion: 1,
    state: state.right,
  });
  return Either.isLeft(response)
    ? privateJson({ error: "tutor-state-invalid" }, { status: 502 })
    : privateJson(response.right);
}

export const GET = observeRoute("tutor-read", handleGET);

export const POST = observeRoute("tutor-action", handlePOST);

export const PATCH = observeRoute("tutor-proposal-resolve", handlePATCH);
