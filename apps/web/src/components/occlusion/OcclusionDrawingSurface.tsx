import { useRef } from "react";
import type { ImageOcclusion, OcclusionPoint } from "@recall/domain";
import { normalizedOcclusionPoint, placeOcclusionMask } from "@recall/application";
import { ImageOcclusionView } from "./ImageOcclusionView";

export function OcclusionDrawingSurface({
  value,
  url,
  onChange,
}: {
  readonly value: ImageOcclusion;
  readonly url: string;
  readonly onChange: (image: ImageOcclusion) => void;
}) {
  const start = useRef<OcclusionPoint | null>(null);
  function point(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return normalizedOcclusionPoint(
      (event.clientX - box.left) / box.width,
      (event.clientY - box.top) / box.height,
    );
  }
  return (
    <div
      className="touch-none w-full max-w-[600px]"
      onPointerDown={(event) => {
        start.current = point(event);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        const first = start.current;
        start.current = null;
        const mask = value.masks.at(-1);
        if (first && mask)
          onChange({
            ...value,
            masks: value.masks.map((item) =>
              item.id === mask.id ? placeOcclusionMask(item, first, point(event)) : item,
            ),
          });
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    >
      <ImageOcclusionView image={value} url={url} />
    </div>
  );
}
