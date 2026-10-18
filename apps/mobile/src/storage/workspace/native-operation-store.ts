import { Effect, Either, Schema } from "effect";
import * as SecureStore from "expo-secure-store";
import type { PublicationForkOperationStore } from "@recall/application";

const lane = Effect.runSync(Effect.makeSemaphore(1));
const indexKey = "recall.pending-operation-keys";
const KeySchema = Schema.String.pipe(
  Schema.pattern(/^recall\.pending-(?:publication|fork)\.[A-Za-z0-9._-]+$/),
);
const IndexSchema = Schema.Array(KeySchema);
const failure = () => ({ _tag: "PublicationForkOperationFailure" }) as const;
const read = (key: string) =>
  Effect.tryPromise({ try: () => SecureStore.getItemAsync(key), catch: failure });
const write = (key: string, value: string) =>
  Effect.tryPromise({ try: () => SecureStore.setItemAsync(key, value), catch: failure });
const remove = (key: string) =>
  Effect.tryPromise({ try: () => SecureStore.deleteItemAsync(key), catch: failure });
const readIndex = () =>
  read(indexKey).pipe(
    Effect.flatMap((raw) =>
      raw === null
        ? Effect.succeed([] as readonly string[])
        : Effect.try({ try: () => JSON.parse(raw) as unknown, catch: failure }).pipe(
            Effect.flatMap(Schema.decodeUnknown(IndexSchema)),
            Effect.mapError(failure),
          ),
    ),
  );
export const withNativeOperationStoreLane = <A, E>(operation: Effect.Effect<A, E>) =>
  lane.withPermits(1)(operation);

/** Check the captured session generation inside the same lane used by erasure. */
export function createNativeOperationStore(
  prefix: "publication" | "fork",
  mayWrite: () => boolean,
): PublicationForkOperationStore {
  const key = (id: string) => `recall.pending-${prefix}.${id.toLowerCase()}`;
  const guarded = <A>(operation: Effect.Effect<A, ReturnType<typeof failure>>) =>
    withNativeOperationStoreLane(
      Effect.suspend(() => (mayWrite() ? operation : Effect.fail(failure()))),
    );
  return {
    read: (id) => guarded(read(key(id))),
    write: (id, value) =>
      guarded(
        Effect.gen(function* () {
          const entry = yield* Schema.decodeUnknown(KeySchema)(key(id)).pipe(
            Effect.mapError(failure),
          );
          const index = yield* readIndex();
          // Index first so interrupted writes remain discoverable during erasure.
          if (!index.includes(entry)) yield* write(indexKey, JSON.stringify([...index, entry]));
          yield* write(entry, prefix === "fork" ? value.toLowerCase() : value);
        }),
      ),
    clear: (id) =>
      guarded(
        Effect.gen(function* () {
          yield* remove(key(id));
          const index = yield* readIndex();
          yield* write(indexKey, JSON.stringify(index.filter((entry) => entry !== key(id))));
        }),
      ),
  };
}

export function clearNativePendingOperations(
  areaIds: readonly string[],
  forkVersionIds: readonly string[] = [],
) {
  return withNativeOperationStoreLane(
    Effect.gen(function* () {
      const index = yield* Effect.either(readIndex());
      const keys = new Set([
        ...(Either.isRight(index) ? index.right : []),
        ...areaIds.flatMap((id) => [
          `recall.pending-publication.${id}`,
          `recall.pending-publication.${id.toLowerCase()}`,
        ]),
        ...forkVersionIds.map((id) => `recall.pending-fork.${id.toLowerCase()}`),
      ]);
      let complete = Either.isRight(index);
      for (const key of keys) {
        const removed = yield* Effect.either(remove(key));
        if (Either.isLeft(removed)) complete = false;
      }
      if (!complete) return yield* Effect.fail(failure());
      yield* remove(indexKey);
    }),
  );
}
