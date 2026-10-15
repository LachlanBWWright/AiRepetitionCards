import { Effect, Schema } from "effect";
import {
  ActivityLibrarySchema,
  ActivityResultSchema,
  CodingExecutionSchema,
  type ActivityLibrary,
  type ActivityResult,
  type ActivityResponse,
  type LearningActivity,
} from "@recall/domain";
import { mergeActivityLibraries, type ActivityFailure } from "./learning-activities";
export type ActivityHttpRequest = {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly body?: unknown;
};
export type ActivityHttpTransport = (
  request: ActivityHttpRequest,
) => Effect.Effect<{ readonly status: number; readonly body: unknown }, ActivityFailure>;
const snapshot = Schema.Struct({
  revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  library: ActivityLibrarySchema,
});
const error = (body: unknown, status: number): ActivityFailure => ({
  _tag: "ActivityFailure",
  reason:
    status === 409
      ? "conflict"
      : status === 400 || status === 422
        ? "invalid-input"
        : "assessment-unavailable",
  message:
    typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : "Learning services are unavailable. Your work is retained; retry.",
});
export function createActivityServices(transport: ActivityHttpTransport) {
  const read = transport({ path: "/api/v1/activities", method: "GET" }).pipe(
    Effect.flatMap((reply) =>
      reply.status === 200
        ? Schema.decodeUnknown(snapshot)(reply.body).pipe(Effect.mapError(() => error(null, 502)))
        : Effect.fail(error(reply.body, reply.status)),
    ),
  );
  return {
    read: read.pipe(Effect.map((value) => value.library)),
    sync: (local: ActivityLibrary): Effect.Effect<ActivityLibrary, ActivityFailure> =>
      Effect.gen(function* () {
        for (let retry = 0; retry < 3; retry += 1) {
          const remote = yield* read;
          const merged = yield* mergeActivityLibraries(local, remote.library);
          const reply = yield* transport({
            path: "/api/v1/activities",
            method: "POST",
            body: { revision: remote.revision, library: merged },
          });
          if (reply.status === 409) continue;
          if (reply.status !== 200) return yield* Effect.fail(error(reply.body, reply.status));
          return yield* Schema.decodeUnknown(snapshot)(reply.body).pipe(
            Effect.map((value) => value.library),
            Effect.mapError(() => error(null, 502)),
          );
        }
        return yield* Effect.fail(
          error({ error: "Activities changed on another device. Retry synchronization." }, 409),
        );
      }),
    assess: (
      activity: LearningActivity,
      response: ActivityResponse,
    ): Effect.Effect<ActivityResult, ActivityFailure> =>
      transport({
        path: "/api/v1/activities/assess",
        method: "POST",
        body: { activity, response },
      }).pipe(
        Effect.flatMap((reply) =>
          reply.status === 200
            ? Schema.decodeUnknown(ActivityResultSchema)(reply.body).pipe(
                Effect.mapError(() => error(null, 502)),
                Effect.filterOrFail(
                  (result) =>
                    result.evidence.every(
                      (entry) =>
                        activity.objectiveIds.includes(entry.objectiveId) &&
                        entry.assistance === response.assistance,
                    ) &&
                    new Set(
                      result.evidence.map((entry) => `${entry.objectiveId}:${entry.dimension}`),
                    ).size === result.evidence.length,
                  () =>
                    error(
                      { error: "The assessment did not match this activity and response." },
                      502,
                    ),
                ),
              )
            : Effect.fail(error(reply.body, reply.status)),
        ),
      ),
    question: (
      activity: LearningActivity,
      response: ActivityResponse,
    ): Effect.Effect<string, ActivityFailure> =>
      transport({
        path: "/api/v1/activities/question",
        method: "POST",
        body: { activity, response },
      }).pipe(
        Effect.flatMap((reply) =>
          reply.status === 200
            ? Schema.decodeUnknown(
                Schema.Struct({
                  question: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
                }),
              )(reply.body).pipe(
                Effect.map((value) => value.question),
                Effect.mapError(() => error(null, 502)),
              )
            : Effect.fail(error(reply.body, reply.status)),
        ),
      ),
  };
}
export type ActivityServices = ReturnType<typeof createActivityServices>;
export { CodingExecutionSchema };
