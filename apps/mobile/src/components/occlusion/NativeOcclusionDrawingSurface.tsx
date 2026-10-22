import { useRef } from "react";
import { View } from "react-native";
import type { ImageOcclusion, OcclusionPoint } from "@recall/domain";
import { normalizedOcclusionPoint, placeOcclusionMask } from "@recall/application";
import { NativeImageOcclusionView } from "./NativeImageOcclusionView";

export function NativeOcclusionDrawingSurface({
  value,
  uri,
  disabled,
  onChange,
}: {
  readonly value: ImageOcclusion;
  readonly uri: string;
  readonly disabled: boolean;
  readonly onChange: (image: ImageOcclusion) => void;
}) {
  const start = useRef<OcclusionPoint | null>(null);
  const width = useRef(1);
  const height = useRef(300);
  return (
    <View
      onLayout={(event) => {
        width.current = event.nativeEvent.layout.width;
        height.current = event.nativeEvent.layout.height;
      }}
      onTouchStart={(event) => {
        if (!disabled)
          start.current = normalizedOcclusionPoint(
            event.nativeEvent.locationX / width.current,
            event.nativeEvent.locationY / height.current,
          );
      }}
      onTouchEnd={(event) => {
        const first = start.current;
        start.current = null;
        const mask = value.masks.at(-1);
        if (!disabled && first && mask) {
          const last = normalizedOcclusionPoint(
            event.nativeEvent.locationX / width.current,
            event.nativeEvent.locationY / height.current,
          );
          onChange({
            ...value,
            masks: value.masks.map((item) =>
              item.id === mask.id ? placeOcclusionMask(item, first, last) : item,
            ),
          });
        }
      }}
    >
      <NativeImageOcclusionView image={value} uri={uri} />
    </View>
  );
}
