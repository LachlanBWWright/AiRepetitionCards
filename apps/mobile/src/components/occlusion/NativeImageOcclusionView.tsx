import { useNativeImageAspectRatio } from "./useNativeImageAspectRatio";
import { useState } from "react";
import type { ImageOcclusion } from "@recall/domain";
import { occlusionBounds, visibleOcclusionMasks } from "@recall/application";
import Svg, { Ellipse, Image as SvgImage, Polygon, Rect } from "react-native-svg";

export function NativeImageOcclusionView({
  image,
  uri,
  revealed = false,
}: {
  readonly image: ImageOcclusion;
  readonly uri: string;
  readonly revealed?: boolean;
}) {
  const ratio = useNativeImageAspectRatio(uri);
  const [width, setWidth] = useState(300);
  return (
    <Svg
      viewBox="0 0 1000 1000"
      width="100%"
      height={width / ratio}
      preserveAspectRatio="none"
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);
      }}
      accessibilityLabel={
        revealed ? "Image occlusion answer" : "Identify the highlighted hidden region"
      }
    >
      <SvgImage href={{ uri }} width={1000} height={1000} preserveAspectRatio="none" />
      {visibleOcclusionMasks(image, revealed).map((mask) => {
        const bounds = occlusionBounds(mask);
        const fill = image.targetMaskIds.includes(mask.id) ? "#dc2626" : "#64748b";
        if (mask.shape === "polygon")
          return (
            <Polygon
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
            <Ellipse
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
          <Rect
            key={mask.id}
            transform={`translate(${String(bounds.x * 1000)},${String(bounds.y * 1000)})`}
            width={bounds.width * 1000}
            height={bounds.height * 1000}
            fill={fill}
            stroke="white"
            strokeWidth={2}
          />
        );
      })}
    </Svg>
  );
}
