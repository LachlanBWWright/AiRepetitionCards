import type { ImageOcclusion, OcclusionMask, OcclusionPoint } from "@recall/domain";

/** Targets are grouped explicitly; masks without a group produce independent questions. */
export function occlusionQuestions(image: ImageOcclusion): readonly (readonly string[])[] {
  const groups = new Map<string, string[]>();
  for (const mask of image.masks) {
    const key = mask.groupId ? `group:${mask.groupId}` : `mask:${mask.id}`;
    groups.set(key, [...(groups.get(key) ?? []), mask.id]);
  }
  return [...groups.values()];
}

export function visibleOcclusionMasks(
  image: ImageOcclusion,
  revealed: boolean,
): readonly OcclusionMask[] {
  return image.masks.filter((mask) => {
    const target = image.targetMaskIds.includes(mask.id);
    return revealed ? image.mode === "hide-all" && !target : image.mode === "hide-all" || target;
  });
}

export function occlusionBounds(mask: OcclusionMask) {
  const xs = mask.points.map((point) => point.x);
  const ys = mask.points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export function normalizedOcclusionPoint(x: number, y: number): OcclusionPoint {
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

export function defaultOcclusionMask(id: string, shape: OcclusionMask["shape"]): OcclusionMask {
  return {
    id,
    label: "",
    shape,
    points:
      shape === "polygon"
        ? [
            { x: 0.2, y: 0.2 },
            { x: 0.8, y: 0.2 },
            { x: 0.5, y: 0.8 },
          ]
        : [
            { x: 0.2, y: 0.2 },
            { x: 0.6, y: 0.4 },
          ],
  };
}

/** Scale a mask into a dragged rectangle, retaining its polygon vertices and identity. */
export function placeOcclusionMask(
  mask: OcclusionMask,
  start: OcclusionPoint,
  end: OcclusionPoint,
): OcclusionMask {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < 0.005 || height < 0.005) return mask;
  const old = occlusionBounds(mask);
  return {
    ...mask,
    points: mask.points.map((point) =>
      normalizedOcclusionPoint(
        x + ((point.x - old.x) / old.width) * width,
        y + ((point.y - old.y) / old.height) * height,
      ),
    ),
  };
}

export function occlusionAnswerLabel(image: ImageOcclusion | undefined, fallback: string): string {
  return (
    image?.masks
      .filter((mask) => image.targetMaskIds.includes(mask.id))
      .map((mask) => mask.label)
      .filter(Boolean)
      .join(" · ") || fallback
  );
}

/** The source image must only be rendered beneath masks, including on the answer side. */
export function occlusionSafeMediaUrls(
  image: ImageOcclusion | undefined,
  urls: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return image
    ? Object.fromEntries(Object.entries(urls).filter(([id]) => id !== image.imageMediaId))
    : urls;
}
