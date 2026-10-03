import { Effect, Either, Schema } from "effect";
import {
  TutorPrivacyPolicySchema,
  DeleteTutorHistoryRequestSchema,
  DeleteTutorHistoryResponseSchema,
  type DeleteTutorHistoryResponse,
} from "@recall/contracts";

export type TutorPrivacyFailure = {
  readonly _tag: "TutorPrivacyFailure";
  readonly reason: "transport" | "http" | "invalid-request" | "invalid-response";
  readonly status?: number;
};
export type TutorPrivacyTransport = (request: {
  readonly method: "GET" | "DELETE";
  readonly path: "/api/v1/tutor/privacy";
  readonly body?: unknown;
}) => Effect.Effect<{ readonly status: number; readonly body: unknown }, TutorPrivacyFailure>;

export function createTutorPrivacyApi(transport: TutorPrivacyTransport) {
  function read<A, I>(
    request: Parameters<TutorPrivacyTransport>[0],
    schema: Schema.Schema<A, I>,
  ): Effect.Effect<A, TutorPrivacyFailure> {
    return transport(request).pipe(
      Effect.flatMap((response): Effect.Effect<A, TutorPrivacyFailure> => {
        if (response.status < 200 || response.status >= 300) {
          return Effect.fail({
            _tag: "TutorPrivacyFailure",
            reason: "http",
            status: response.status,
          } as const);
        }
        return Schema.decodeUnknown(schema)(response.body).pipe(
          Effect.mapError(
            () => ({ _tag: "TutorPrivacyFailure", reason: "invalid-response" }) as const,
          ),
        );
      }),
    );
  }
  return {
    readPolicy: () =>
      read({ method: "GET", path: "/api/v1/tutor/privacy" }, TutorPrivacyPolicySchema),
    deleteHistory: (
      confirmation: unknown,
    ): Effect.Effect<DeleteTutorHistoryResponse, TutorPrivacyFailure> => {
      const decoded = Schema.decodeUnknownEither(DeleteTutorHistoryRequestSchema)({ confirmation });
      return Either.isLeft(decoded)
        ? Effect.fail({ _tag: "TutorPrivacyFailure", reason: "invalid-request" } as const)
        : read(
            { method: "DELETE", path: "/api/v1/tutor/privacy", body: decoded.right },
            DeleteTutorHistoryResponseSchema,
          );
    },
  };
}
