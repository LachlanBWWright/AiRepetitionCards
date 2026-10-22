import { useState } from "react";
import type { Assessment, ImageOcclusion } from "@recall/domain";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import {
  useReviewCardMedia,
  type ReviewMediaPreview,
} from "@/features/dashboard/review/useReviewCardMedia";
import { ImageOcclusionEditor } from "./ImageOcclusionEditor";

export function CardOcclusionEditor({
  sourceCard,
  value,
  onChange,
  removedMediaIds,
  disabled,
}: {
  readonly sourceCard?: Assessment | undefined;
  readonly value: ImageOcclusion | undefined;
  readonly onChange: (value: ImageOcclusion | undefined) => void;
  readonly removedMediaIds: readonly string[];
  readonly disabled: boolean;
}) {
  const [previews, setPreviews] = useState<readonly ReviewMediaPreview[]>([]);
  useReviewCardMedia(browserMediaStore, sourceCard, setPreviews);
  const url = previews.find((preview) => preview.id === value?.imageMediaId)?.url;
  return (
    <ImageOcclusionEditor
      value={value}
      onChange={onChange}
      media={(sourceCard?.media ?? []).filter(
        (reference) => !removedMediaIds.includes(reference.id),
      )}
      disabled={disabled}
      {...(url ? { url } : {})}
    />
  );
}
