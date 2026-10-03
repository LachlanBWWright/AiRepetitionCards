import { Effect, Either } from "effect";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import type { MediaId } from "@recall/domain";

export type MediaPersistenceFailure = {
  readonly _tag: "MediaPersistenceFailure";
};

export function persistMediaAssets(
  mediaStore: MediaStore,
  assets: readonly StoredMediaAsset[],
): Effect.Effect<void, MediaPersistenceFailure> {
  return Effect.gen(function* () {
    const listed = yield* mediaStore.list.pipe(
      Effect.mapError((): MediaPersistenceFailure => ({ _tag: "MediaPersistenceFailure" })),
    );
    const previouslyPresent = new Set(listed.map((reference) => reference.id));
    const attempted: MediaId[] = [];
    for (const asset of assets) {
      if (!previouslyPresent.has(asset.reference.id)) attempted.push(asset.reference.id);
      const write = yield* Effect.either(mediaStore.put(asset));
      if (Either.isLeft(write)) {
        yield* Effect.forEach(attempted, (id) => mediaStore.delete(id).pipe(Effect.ignore), {
          concurrency: 1,
        });
        return yield* Effect.fail({ _tag: "MediaPersistenceFailure" } as const);
      }
    }
  });
}
