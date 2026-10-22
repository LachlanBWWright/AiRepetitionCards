import type { OcclusionMask } from "@recall/domain";
import { Text, View } from "react-native";
import { NativeButton } from "../ui/NativeButton";
import type { CardEditorField } from "../authoring/editor/NativeWorkspaceCardEditor";

export function NativeOcclusionMaskFields({
  mask,
  index,
  field,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  readonly mask: OcclusionMask;
  readonly index: number;
  readonly field: CardEditorField;
  readonly disabled: boolean;
  readonly canRemove: boolean;
  readonly onChange: (mask: OcclusionMask) => void;
  readonly onRemove: () => void;
}) {
  function changeCoordinate(pointIndex: number, axis: "x" | "y", text: string) {
    const number = Number(text);
    if (Number.isFinite(number))
      onChange({
        ...mask,
        points: mask.points.map((point, index) =>
          index === pointIndex ? { ...point, [axis]: number } : point,
        ),
      });
  }
  const changePoint = (pointIndex: number, axis: "x" | "y") => (text: string) => {
    changeCoordinate(pointIndex, axis, text);
  };
  return (
    <View className="gap-2 border border-recall-line p-2">
      <Text>
        Mask {index + 1}: {mask.shape}
      </Text>
      {field(`Mask ${String(index + 1)} label`, mask.label, (label) => {
        onChange({ ...mask, label });
      })}
      {field(`Mask ${String(index + 1)} group`, mask.groupId ?? "", (groupId) => {
        onChange({ ...mask, groupId: groupId || undefined });
      })}
      {mask.points.map((point, pointIndex) => (
        <View key={pointIndex}>
          {(["x", "y"] as const).map((axis) => (
            <View key={axis}>
              {field(
                `Mask ${String(index + 1)} point ${String(pointIndex + 1)} ${axis}`,
                String(point[axis]),
                changePoint(pointIndex, axis),
              )}
            </View>
          ))}
        </View>
      ))}
      {mask.shape === "polygon" && mask.points.length < 32 && (
        <NativeButton
          label="Add polygon vertex"
          tone="soft"
          disabled={disabled}
          onPress={() => {
            onChange({ ...mask, points: [...mask.points, { x: 0.1, y: 0.5 }] });
          }}
        />
      )}
      {mask.shape === "polygon" && mask.points.length > 3 && (
        <NativeButton
          label="Remove last vertex"
          tone="soft"
          disabled={disabled}
          onPress={() => {
            onChange({ ...mask, points: mask.points.slice(0, -1) });
          }}
        />
      )}
      <NativeButton
        label="Remove mask"
        tone="soft"
        disabled={disabled || !canRemove}
        onPress={onRemove}
      />
    </View>
  );
}
