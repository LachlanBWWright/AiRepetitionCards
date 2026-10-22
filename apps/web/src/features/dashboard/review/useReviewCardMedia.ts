import { useEffect } from "react";
import { Effect, Either } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import { isSupportedMediaContent } from "@recall/application";
import type { MediaStore } from "@recall/local-store";
import type { Assessment } from "@recall/domain";
export type ReviewMediaPreview = {
  readonly id?: string;
  readonly mimeType: string;
  readonly url: string;
};
export function useReviewCardMedia(
  store: MediaStore,
  card: Assessment | undefined,
  setMediaPreviews: (previews: readonly ReviewMediaPreview[]) => void,
  mockPreviews?: readonly ReviewMediaPreview[],
) {
  useEffect(() => {
    if (mockPreviews?.length) return;
    setMediaPreviews([]);
    let active = true;
    const isActive = () => active;
    const urls: string[] = [];
    const references = card?.media ?? [];
    void Effect.runPromise(
      Effect.either(Effect.forEach(references, (reference) => store.get(reference.id))),
    ).then((result) => {
      if (Either.isLeft(result)) return;
      const previews = result.right.flatMap((asset) => {
        if (!asset) return [];
        const copy = new Uint8Array(asset.bytes.byteLength);
        copy.set(asset.bytes);
        const contentId = Array.from(sha256(copy), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (
          contentId !== asset.reference.id ||
          !isSupportedMediaContent(copy, asset.reference.mimeType)
        )
          return [];
        const url = URL.createObjectURL(
          new Blob([copy.buffer], { type: asset.reference.mimeType }),
        );
        urls.push(url);
        return [{ id: asset.reference.id, mimeType: asset.reference.mimeType, url }];
      });
      if (isActive()) setMediaPreviews(previews);
      else
        urls.forEach((url) => {
          URL.revokeObjectURL(url);
        });
    });
    return () => {
      active = false;
      urls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
  }, [card?.id, card?.media, mockPreviews, setMediaPreviews, store]);
}
