import { useEffect } from "react";
import { Effect, Either } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import { isSupportedMediaContent } from "@recall/application";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import type { RecallDashboardCore } from "./useRecallDashboardController";

export function useRecallDashboardDraftEffects(
  model: Pick<RecallDashboardCore, "demo" | "card" | "setMediaPreviews">,
) {
  const { demo, card, setMediaPreviews } = model;
  useEffect(() => {
    if (demo?.mockMediaPreviews?.length) return;
    let active = true;
    const isActive = () => active;
    const urls: string[] = [];
    const references = card?.media ?? [];
    void Effect.runPromise(
      Effect.either(Effect.forEach(references, (reference) => browserMediaStore.get(reference.id))),
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
        return [{ mimeType: asset.reference.mimeType, url }];
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
  }, [card?.id, card?.media, demo?.mockMediaPreviews, setMediaPreviews]);
}
