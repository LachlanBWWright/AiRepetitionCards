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
  TutorApiRequestSchema,
} from "@recall/ai-core";
import {
  prepareTutorWorkflow,
  executeTutorWorkflow,
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
import { buildTutorSessionStateResponse } from "./tutor-route-session-state";
import { persistTutorTransition } from "./tutor-route-persist-response";
import { handleTutorProposalPatch } from "./tutor-route-patch";
import {
  loadTutorSession,
  readTutorObservationPayload,
  readTutorObservationHistory,
  readTutorProposal,
  readTutorCanonicalArea,
} from "@recall/infra-supabase/tutor-repository";
import {
  recordTutorUsage,
  reserveTutorCall,
  repairTutorSessionApprovalRevisions,
} from "@recall/infra-supabase/tutor-writes";

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

function aiFailureResponse(error: AiProviderError): NextResponse {
  let status = 503;
  let message = "AI tutoring is temporarily unavailable.";
  switch (error._tag) {
    case "AiRateLimited":
      status = 429;
      message = "The tutor is busy. Try again shortly.";
      break;
    case "AiBudgetExceeded":
      status = 429;
      message = "You have reached today’s hosted AI budget. Try again tomorrow.";
      break;
    case "AiContextBudgetExceeded":
      status = 413;
      message =
        "Required tutor context is too large. Shorten objective descriptions or AI instructions.";
      break;
    case "AiBudgetUnavailable":
      message = "Hosted AI budgeting is temporarily unavailable. Try again later.";
      break;
    case "AiRefusal":
      message = "The tutor could not help with that request. Try rephrasing it.";
      break;
    case "AiQuotaExceeded":
      message =
        "The hosted AI account has exhausted its quota. Ask the operator to check API funding.";
      break;
    case "AiStructuredOutputError":
      message = "The tutor response could not be validated. Try again.";
      break;
    case "AiProviderUnavailable":
      break;
  }
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
        operation.action === "study-card" ||
          operation.action === "refine-card" ||
          operation.action === "plan-study"
          ? "propose-card"
          : operation.action === "inspect-card"
            ? "evaluate"
            : operation.action,
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
  return persistTutorTransition(
    auth.client,
    auth.userId,
    prepared.right.createsSession,
    observationId,
    transition.right,
  );
}

async function handlePATCH(request: NextRequest): Promise<NextResponse> {
  return handleTutorProposalPatch(request, requireUser, workflowFailureResponse);
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

  return buildTutorSessionStateResponse(auth.client, auth.userId, sessionId, session);
}

export const GET = observeRoute("tutor-read", handleGET);

export const POST = observeRoute("tutor-action", handlePOST);

export const PATCH = observeRoute("tutor-proposal-resolve", handlePATCH);
