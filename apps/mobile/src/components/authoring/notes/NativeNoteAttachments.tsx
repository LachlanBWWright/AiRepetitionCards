import type { Effect } from "effect";
import type { StoredMediaAsset } from "@recall/local-store";
import type { LearningArea } from "@recall/domain";
import type { NoteAuthoringModel } from "@recall/react";
import { Text, View } from "react-native";
import { NativeButton } from "../../ui/NativeButton";

type Props = {
  readonly model: NoteAuthoringModel;
  readonly disabled: boolean;
  readonly area: LearningArea;
  readonly pickAttachment?:
    (() => Effect.Effect<StoredMediaAsset | null, { readonly message: string }>) | undefined;
};
export function NativeNoteAttachments({ model, disabled, area, pickAttachment }: Props) {
  return (
    <View className="gap-2">
      {pickAttachment && (
        <NativeButton
          label="Attach image or audio"
          tone="soft"
          disabled={disabled || (model.note.media?.length ?? 0) >= 20}
          onPress={() => {
            model.addAttachment(pickAttachment());
          }}
        />
      )}
      {(model.note.media ?? []).map((media, index) => (
        <View key={media.id}>
          <Text>
            Attachment {index + 1} · {media.mimeType}
          </Text>
          <NativeButton
            label="Remove attachment"
            tone="soft"
            disabled={disabled}
            onPress={() => {
              model.removeAttachment(media.id);
            }}
          />
        </View>
      ))}
      {(area.objectives ?? []).map((objective) => (
        <NativeButton
          key={objective.id}
          label={`${model.note.objectiveIds.includes(objective.id) ? "✓ " : ""}${objective.title}`}
          disabled={disabled}
          tone="soft"
          onPress={() => {
            model.toggleObjective(objective.id);
          }}
        />
      ))}
    </View>
  );
}
