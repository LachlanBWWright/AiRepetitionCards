import { Effect, Either } from "effect";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";

export type MediaPersistenceFailure = {
  readonly _tag: "MediaPersistenceFailure";
};

/** A failed batch retains prior writes because another commit may already depend on them. */
export function persistMediaAssets(
  mediaStore: MediaStore,
  assets: readonly StoredMediaAsset[],
): Effect.Effect<void, MediaPersistenceFailure> {
  return Effect.gen(function* () {
    for (const asset of assets) {
      const write = yield* Effect.either(mediaStore.put(asset));
      if (Either.isLeft(write)) {
        return yield* Effect.fail({ _tag: "MediaPersistenceFailure" } as const);
      }
    }
  });
}
