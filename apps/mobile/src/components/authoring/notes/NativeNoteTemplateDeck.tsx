import { Text, View } from "react-native";
import type { NoteAuthoringModel } from "@recall/react";
import { NativeButton } from "../../ui/NativeButton";
export function NativeNoteTemplateDeck({
  model,
  templateId,
  disabled,
}: {
  readonly model: NoteAuthoringModel;
  readonly templateId: string;
  readonly disabled: boolean;
}) {
  const template = model.type.templates.find((item) => item.id === templateId);
  return (
    <View className="gap-2">
      <Text className="text-recall-ink">Card subject</Text>
      {model.availableAreas.map((area) => (
        <NativeButton
          key={area.id}
          label={area.title}
          tone="soft"
          selected={(template?.deckAreaId ?? model.area.id) === area.id}
          disabled={disabled}
          onPress={() => {
            model.updateTemplate(templateId, {
              deckAreaId: area.id === model.area.id ? undefined : area.id,
            });
          }}
        />
      ))}
    </View>
  );
}
