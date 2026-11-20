import type { StudyCardMatch } from "@recall/application";
import type { Assessment, LearningArea } from "@recall/domain";
import { NativeButton } from "@recall/ui-native";
import { Text, View } from "react-native";
import { NativeCardRichText } from "../authoring/rich/NativeCardRichText";

export function NativeBrowserSelection({
  selected,
  related,
  onEdit,
  onBack,
  disabled,
}: {
  readonly selected: StudyCardMatch;
  readonly related: readonly StudyCardMatch[];
  readonly onEdit?: ((area: LearningArea, card: Assessment) => void) | undefined;
  readonly onBack: () => void;
  readonly disabled: boolean;
}) {
  return (
    <View className="gap-4">
      <NativeButton variant="secondary" label="Back to search results" onPress={onBack} />
      <Text className="text-sm text-recall-muted">{selected.area.title}</Text>
      <View className="gap-4 rounded-xl border border-recall-line bg-recall-surface p-4">
        <Text className="text-sm text-recall-muted">Question</Text>
        <NativeCardRichText text={selected.card.front} variant="body" />
        <Text className="text-sm text-recall-muted">Answer</Text>
        <NativeCardRichText text={selected.card.back} variant="body" />
        {onEdit && (
          <NativeButton
            label="Edit selected card"
            disabled={disabled}
            onPress={() => {
              onEdit(selected.area, selected.card);
            }}
          />
        )}
      </View>
      <Text className="text-base font-semibold text-recall-ink">
        Related cards ({related.length})
      </Text>
      {related.slice(0, 10).map((entry) => (
        <NativeCardRichText key={entry.card.id} text={entry.card.front} variant="body" />
      ))}
      {related.length > 10 && (
        <Text className="text-sm text-recall-muted">Showing the first 10 related cards.</Text>
      )}
    </View>
  );
}
