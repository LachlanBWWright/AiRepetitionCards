import { Effect, Either, Schema } from "effect";
import {
  ResolveTutorProposalRequestSchema,
  ResolveTutorProposalResponseSchema,
  ResolveProposalRequestSchema,
  TutorApiRequestSchema,
  TutorApiResponseSchema,
  TutorActionRequestSchema,
  TutorSessionStateResponseSchema,
  type TutorActionRequest,
  type TutorActionResponse,
  type TutorSessionState,
  selectTutorInferenceContext,
} from "@recall/ai-core";
import { tutorAreaFingerprint } from "./tutor-context-transport";
import { ApiRateLimitErrorResponseSchema } from "@recall/contracts";

export type TutorHttpRequest = {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly body?: unknown;
};

export type TutorHttpResponse = {
  readonly status: number;
  readonly body: unknown;
};

export type TutorTransportError = { readonly _tag: "TutorTransportError" };
export type TutorTransport = (
  request: TutorHttpRequest,
) => Effect.Effect<TutorHttpResponse, TutorTransportError>;

export type TutorApiFailure =
  | TutorTransportError
  | {
      readonly _tag: "TutorApiFailure";
      readonly reason: "http";
      readonly status: number;
      readonly code: string | null;
      readonly retryAfterSeconds?: number;
    }
  | { readonly _tag: "TutorApiFailure"; readonly reason: "invalid-response" };

function errorCode(body: unknown): string | null {
  return typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
    ? body.error
    : null;
}

function decode<A, I>(
  response: TutorHttpResponse,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, TutorApiFailure> {
  if (response.status < 200 || response.status >= 300) {
    const code = errorCode(response.body);
    if (code === "rate-limited" || code === "rate-limit-unavailable") {
      const rateLimit = Schema.decodeUnknownEither(ApiRateLimitErrorResponseSchema)(response.body);
      if (Either.isLeft(rateLimit) || response.status !== (code === "rate-limited" ? 429 : 503))
        return Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" });
      return Effect.fail({
        _tag: "TutorApiFailure",
        reason: "http",
        status: response.status,
        code,
        ...(rateLimit.right.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: rateLimit.right.retryAfterSeconds }),
      });
    }
    return Effect.fail({
      _tag: "TutorApiFailure",
      reason: "http",
      status: response.status,
      code,
    });
  }
  const result = Schema.decodeUnknownEither(schema)(response.body);
  return Either.isLeft(result)
    ? Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" })
    : Effect.succeed(result.right);
}

const failureMessages: Readonly<Record<string, string>> = {
  "invalid-request": "Check your tutor request and try again.",
  "request-too-large": "This tutor request is too large. Shorten your message or context.",
  "session-not-found": "This tutor session is no longer available. Start a new session.",
  "session-area-mismatch": "This tutor session belongs to another area. Start a new session here.",
  "invalid-session": "This tutor session could not be validated. Start a new session.",
  "invalid-session-id": "This tutor session could not be identified. Start a new session.",
  "unknown-objective":
    "That learning objective is no longer available. Choose a current objective.",
  "question-required": "Write a question before asking the tutor.",
  "quiz-not-found": "This quiz is no longer available. Generate a new quiz.",
  "quiz-question-not-found": "This quiz question is no longer available. Reload the session.",
  "quiz-answer-already-evaluated":
    "This answer has already been evaluated. Reload the session to see its feedback.",
  "observation-not-found":
    "This learning evidence is no longer available. Continue tutoring before proposing a card.",
  "proposal-not-recommended":
    "This feedback does not support a card proposal yet. Continue practicing first.",
  "proposal-not-found": "This proposal is no longer available. Reload the tutor session.",
  "proposal-not-pending":
    "This proposal has already been resolved. Reload the tutor session before retrying.",
  "context-budget-exceeded":
    "Required tutor context is too large. Shorten objective descriptions or AI instructions.",
  "unsupported-operation":
    "This AI provider does not support that tutor action. Choose another provider.",
  "structured-output-unsupported":
    "This AI provider cannot return validated tutor content. Choose another provider.",
  "invalid-provider-capabilities":
    "This AI provider configuration could not be validated. Choose another provider or try again later.",
  "output-budget-exceeded":
    "The tutor response exceeded this provider's output limit. Try a smaller request.",
  "invalid-provider-response": "The tutor response could not be validated. Try again.",
  "proposal-response-invalid":
    "The proposal acknowledgement could not be validated. Keep your saved card and retry.",
  "tutor-state-invalid": "The tutor session response could not be validated. Try loading it again.",
  "tutor-storage-unavailable":
    "Tutor session storage is temporarily unavailable. Your current work remains available; try again later.",
};

/** Share actionable recovery across clients without confusing request throttling with daily quotas. */
export function tutorApiFailureMessage(failure: TutorApiFailure): string {
  if (failure._tag === "TutorTransportError")
    return "Tutor connection failed. Check your network and API URL, then try again.";
  if (failure.reason === "invalid-response")
    return "Tutor returned a response this app could not validate. Try again.";
  if (failure.code === "rate-limited" && failure.status === 429)
    return `Too many tutor requests. Wait ${String(failure.retryAfterSeconds ?? 60)} seconds before trying again.`;
  if (failure.code === "rate-limit-unavailable" && failure.status === 503)
    return `Tutor requests are temporarily unavailable. Wait ${String(failure.retryAfterSeconds ?? 60)} seconds and try again.`;
  if (failure.code) {
    const message = Object.hasOwn(failureMessages, failure.code)
      ? failureMessages[failure.code]
      : undefined;
    if (message) return message;
    // Existing server-owned human messages include budget, refusal and context recovery instructions.
    if (/\s/.test(failure.code)) return failure.code;
  }
  if (failure.status === 401 || failure.status === 403) return "Sign in again to use the tutor.";
  if (failure.status === 429) return "The tutor is busy. Try again shortly.";
  if (failure.status === 413)
    return "This tutor request is too large. Shorten your message or context.";
  return "Tutor could not complete that request. Your current work remains available; try again.";
}

export function createTutorApi(transport: TutorTransport) {
  return {
    request(input: TutorActionRequest): Effect.Effect<TutorActionResponse, TutorApiFailure> {
      const validated = Schema.decodeUnknownEither(TutorActionRequestSchema)(input);
      if (Either.isLeft(validated))
        return Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" });
      const request = Schema.decodeUnknownEither(TutorApiRequestSchema)({
        schemaVersion: 1,
        request: validated.right,
      });
      if (Either.isLeft(request))
        return Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" });
      const compact = Effect.gen(function* () {
        const action = validated.right;
        if (!("context" in action) || !action.context) return request.right;
        const context = yield* selectTutorInferenceContext(
          action.context,
          undefined,
          action.action === "targeted-quiz" ? action.objectiveId : null,
        ).pipe(
          Effect.mapError(
            () =>
              ({
                _tag: "TutorApiFailure",
                reason: "http",
                status: 413,
                code: "Required tutor context is too large. Shorten objective descriptions or AI instructions.",
              }) as const,
          ),
        );
        return {
          ...request.right,
          request: {
            ...action,
            context,
            ...(context.knowledgeArea !== action.context.knowledgeArea
              ? { canonicalAreaFingerprint: tutorAreaFingerprint(action.context.knowledgeArea) }
              : {}),
          },
        };
      });
      return compact.pipe(
        Effect.flatMap((body) => transport({ method: "POST", path: "/api/v1/tutor", body })),
        Effect.flatMap((response) => decode(response, TutorApiResponseSchema)),
        Effect.map((response) => response.response),
      );
    },

    readSession(sessionId: string): Effect.Effect<TutorSessionState | null, TutorApiFailure> {
      return transport({
        method: "GET",
        path: `/api/v1/tutor?sessionId=${encodeURIComponent(sessionId)}`,
      }).pipe(
        Effect.flatMap((response) =>
          response.status === 404 &&
          errorCode(response.body) !== "rate-limited" &&
          errorCode(response.body) !== "rate-limit-unavailable"
            ? Effect.succeed(null)
            : decode(response, TutorSessionStateResponseSchema).pipe(
                Effect.map((state) => state.state),
              ),
        ),
      );
    },

    resolveProposal(
      input: typeof ResolveProposalRequestSchema.Type,
    ): Effect.Effect<void, TutorApiFailure> {
      const validated = Schema.decodeUnknownEither(ResolveProposalRequestSchema)(input);
      if (Either.isLeft(validated))
        return Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" });
      const request = Schema.decodeUnknownEither(ResolveTutorProposalRequestSchema)({
        schemaVersion: 1,
        request: validated.right,
      });
      if (Either.isLeft(request))
        return Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" });
      return transport({ method: "PATCH", path: "/api/v1/tutor", body: request.right }).pipe(
        Effect.flatMap((response) => decode(response, ResolveTutorProposalResponseSchema)),
        Effect.flatMap((result) =>
          result.proposalId === validated.right.proposalId && result.state === validated.right.state
            ? Effect.void
            : Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" } as const),
        ),
      );
    },
  };
}
