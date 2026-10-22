import { Text, View } from "react-native";
import type { NoteAuthoringModel } from "@recall/react";
import { NativeButton } from "../../ui/NativeButton";
export function NativeNoteOwnershipImpact({
  model,
  disabled,
}: {
  readonly model: NoteAuthoringModel;
  readonly disabled: boolean;
}) {
  if (!model.ownershipConflicts.length) return null;
  return (
    <View className="gap-2 border border-recall-line p-3">
      <Text>Linked subjects contain stale or independently edited note snapshots.</Text>
      {model.ownershipConflicts.map((conflict) => (
        <View key={`${conflict.areaId}:${conflict.noteId}`}>
          <Text className="font-bold">{conflict.areaTitle}</Text>
          {Object.entries(conflict.fields).map(([name, value]) => (
            <Text key={name}>
              {name}: {value}
            </Text>
          ))}
        </View>
      ))}
      <NativeButton
        tone="soft"
        disabled={disabled}
        label={`${model.migration?.confirmLinkedSnapshots ? "✓ " : ""}Replace these snapshots with this source note when saving`}
        onPress={() => {
          model.confirmLinkedSnapshots(!model.migration?.confirmLinkedSnapshots);
        }}
      />
    </View>
  );
}
