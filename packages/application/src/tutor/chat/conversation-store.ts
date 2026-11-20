import { Effect, Schema } from "effect";
import type { SubjectDialogue } from "./subject-tutor";

export const TutorConversationSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scope: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1024)),
  areaId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  history: Schema.Array(
    Schema.Struct({
      role: Schema.Literal("learner", "assistant"),
      content: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000)),
    }),
  ).pipe(Schema.maxItems(100)),
  draft: Schema.String.pipe(Schema.maxLength(2000)),
}).pipe(Schema.filter((value) => JSON.stringify(value).length <= 200_000));
export type TutorConversation = typeof TutorConversationSchema.Type;
export type ConversationFailure = { readonly message: string };
export type ConversationRecordPort = {
  readonly read: Effect.Effect<string | null, ConversationFailure>;
  readonly commit: (
    expected: string | null,
    next: string | null,
  ) => Effect.Effect<void, ConversationFailure>;
};
export type TutorConversationStore = ReturnType<typeof createTutorConversationStore>;
const invalid = {
  message: "The saved conversation could not be validated. It has not been overwritten.",
};

/** Storage is device-local and scoped to both owner/provider and subject. */
export function createTutorConversationStore(
  scope: string,
  areaId: string,
  port: ConversationRecordPort,
) {
  const lane = Effect.runSync(Effect.makeSemaphore(1));
  let observed: string | null | undefined;
  const read = lane.withPermits(1)(
    Effect.gen(function* () {
      const raw = yield* port.read;
      if (raw === null) {
        observed = null;
        return null;
      }
      const value = yield* Schema.decodeUnknown(Schema.parseJson(TutorConversationSchema))(
        raw,
      ).pipe(Effect.mapError(() => invalid));
      if (value.scope !== scope || value.areaId !== areaId) return yield* Effect.fail(invalid);
      observed = raw;
      return value;
    }),
  );
  const write = (history: SubjectDialogue, draft: string) =>
    lane.withPermits(1)(
      Effect.gen(function* () {
        if (observed === undefined) return yield* Effect.fail(invalid);
        let recent = history.slice(-100);
        while (recent.length > 0 && JSON.stringify(recent).length > 190_000)
          recent = recent.slice(2);
        const value = yield* Schema.decodeUnknown(TutorConversationSchema)({
          schemaVersion: 1,
          scope,
          areaId,
          history: recent,
          draft,
        }).pipe(Effect.mapError(() => invalid));
        const serialized = JSON.stringify(value);
        yield* port.commit(observed, serialized);
        observed = serialized;
      }),
    );
  const clear = lane.withPermits(1)(
    Effect.gen(function* () {
      const baseline = observed === undefined ? yield* port.read : observed;
      yield* port.commit(baseline, null);
      observed = null;
    }),
  );
  return { read, write, clear };
}
