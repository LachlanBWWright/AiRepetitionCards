import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Effect, Either } from "effect";
import { File, Paths } from "expo-file-system";
import { verifyMediaAsset } from "@recall/application";
import type { MediaStore } from "@recall/local-store";
import type { Assessment } from "@recall/domain";

export function useNativeCardMedia(
  mediaStore: MediaStore | null,
  card: Assessment | undefined,
  revision: number,
): readonly [
  Readonly<Record<string, string>>,
  Dispatch<SetStateAction<Readonly<Record<string, string>>>>,
] {
  const [mediaUris, setMediaUris] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    if (!mediaStore || !card?.media?.length) return;
    let active = true;
    const isActive = () => active;
    const cacheAssets = Effect.forEach(card.media, (reference) =>
      Effect.gen(function* () {
        const asset = yield* mediaStore.get(reference.id);
        if (!asset || !verifyMediaAsset(asset)) return null;
        const extension: Record<typeof reference.mimeType, string> = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/gif": "gif",
          "image/webp": "webp",
          "audio/mpeg": "mp3",
          "audio/ogg": "ogg",
          "audio/wav": "wav",
          "audio/mp4": "m4a",
          "audio/webm": "webm",
        };
        const file = yield* Effect.try({
          try: () =>
            new File(Paths.cache, `recall-${reference.id}.${extension[reference.mimeType]}`),
          catch: () => ({ _tag: "MediaCacheFailure" }) as const,
        });
        yield* Effect.try({
          try: () => {
            file.write(asset.bytes);
          },
          catch: () => ({ _tag: "MediaCacheFailure" }) as const,
        });
        return { id: reference.id, uri: file.uri };
      }),
    );
    void Effect.runPromise(Effect.either(cacheAssets)).then((result) => {
      if (!isActive() || Either.isLeft(result)) return;
      const nextUris = result.right.reduce<Record<string, string>>((uris, asset) => {
        if (asset) uris[asset.id] = asset.uri;
        return uris;
      }, {});
      setMediaUris(nextUris);
    });
    return () => {
      active = false;
    };
  }, [card?.id, card?.media, mediaStore, revision]);

  return [mediaUris, setMediaUris] as const;
}
