import { useImageAspectRatio } from "./useImageAspectRatio";
import type { ImageOcclusion } from "@recall/domain";
import { occlusionBounds, visibleOcclusionMasks } from "@recall/application";

export function ImageOcclusionView({
  image,
  url,
  revealed = false,
}: {
  readonly image: ImageOcclusion;
  readonly url: string;
  readonly revealed?: boolean;
}) {
  const ratio = useImageAspectRatio(url);
  return (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      style={{ aspectRatio: ratio }}
      role="img"
      aria-label={revealed ? "Image occlusion answer" : "Identify the highlighted hidden region"}
      className="w-full max-w-[600px] rounded-md"
    >
      <image href={url} width="1000" height="1000" preserveAspectRatio="none" />
      {visibleOcclusionMasks(image, revealed).map((mask) => {
        const bounds = occlusionBounds(mask);
        const fill = image.targetMaskIds.includes(mask.id) ? "#dc2626" : "#64748b";
        if (mask.shape === "polygon")
          return (
            <polygon
              key={mask.id}
              points={mask.points
                .map((p) => `${String(p.x * 1000)},${String(p.y * 1000)}`)
                .join(" ")}
              fill={fill}
              stroke="white"
              strokeWidth={2}
            />
          );
        if (mask.shape === "ellipse")
          return (
            <ellipse
              key={mask.id}
              cx={(bounds.x + bounds.width / 2) * 1000}
              cy={(bounds.y + bounds.height / 2) * 1000}
              rx={bounds.width * 500}
              ry={bounds.height * 500}
              fill={fill}
              stroke="white"
              strokeWidth={2}
            />
          );
        return (
          <rect
            key={mask.id}
            x={bounds.x * 1000}
            y={bounds.y * 1000}
            width={bounds.width * 1000}
            height={bounds.height * 1000}
            fill={fill}
            stroke="white"
            strokeWidth={2}
          />
        );
      })}
    </svg>
  );
}
