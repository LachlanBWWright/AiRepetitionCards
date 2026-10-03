import { Effect, Either, Schema } from "effect";
import {
  ResolveProposalRequestSchema,
  TutorActionRequestSchema,
  TutorActionResponseSchema,
  TutorSessionStateSchema,
  type TutorActionRequest,
  type TutorActionResponse,
  type TutorSessionState,
} from "@recall/ai-core";

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
    }
  | { readonly _tag: "TutorApiFailure"; readonly reason: "invalid-response" };

const ProposalResolutionSchema = Schema.Struct({
  proposalId: Schema.String,
  state: Schema.Union(Schema.Literal("approved"), Schema.Literal("rejected")),
});

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
    return Effect.fail({
      _tag: "TutorApiFailure",
      reason: "http",
      status: response.status,
      code: errorCode(response.body),
    });
  }
  const result = Schema.decodeUnknownEither(schema)(response.body);
  return Either.isLeft(result)
    ? Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" })
    : Effect.succeed(result.right);
}

export function createTutorApi(transport: TutorTransport) {
  return {
    request(input: TutorActionRequest): Effect.Effect<TutorActionResponse, TutorApiFailure> {
      const validated = Schema.decodeUnknownEither(TutorActionRequestSchema)(input);
      if (Either.isLeft(validated))
        return Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" });
      return transport({ method: "POST", path: "/api/v1/tutor", body: validated.right }).pipe(
        Effect.flatMap((response) => decode(response, TutorActionResponseSchema)),
      );
    },

    readSession(sessionId: string): Effect.Effect<TutorSessionState | null, TutorApiFailure> {
      return transport({
        method: "GET",
        path: `/api/v1/tutor?sessionId=${encodeURIComponent(sessionId)}`,
      }).pipe(
        Effect.flatMap((response) =>
          response.status === 404
            ? Effect.succeed(null)
            : decode(response, TutorSessionStateSchema),
        ),
      );
    },

    resolveProposal(
      input: typeof ResolveProposalRequestSchema.Type,
    ): Effect.Effect<void, TutorApiFailure> {
      const validated = Schema.decodeUnknownEither(ResolveProposalRequestSchema)(input);
      if (Either.isLeft(validated))
        return Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" });
      return transport({ method: "PATCH", path: "/api/v1/tutor", body: validated.right }).pipe(
        Effect.flatMap((response) => decode(response, ProposalResolutionSchema)),
        Effect.flatMap((result) =>
          result.proposalId === validated.right.proposalId && result.state === validated.right.state
            ? Effect.void
            : Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" } as const),
        ),
      );
    },
  };
}
