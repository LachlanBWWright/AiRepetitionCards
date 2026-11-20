import { View, Text } from "react-native";
import { NativeButton, NativeNavigationLink } from "@recall/ui-native";
import type { SubjectSummary, SubjectActivity } from "@recall/application";

export function NativeSubjectSummaryRow({
  row,
  disabled,
  onOpen,
}: {
  readonly row: SubjectSummary;
  readonly disabled: boolean;
  readonly onOpen: (activity: SubjectActivity) => void;
}) {
  return (
    <View className="flex-row items-center gap-3 border-b border-recall-line py-4">
      <View className="flex-1 gap-2">
        <View className="flex-row items-center gap-3">
          <View className="size-3 rounded-full" style={{ backgroundColor: row.area.color }} />
          <NativeNavigationLink
            label={row.area.title}
            disabled={disabled}
            onPress={() => {
              onOpen("overview");
            }}
          />
        </View>
        <Text className="text-sm text-recall-muted">
          {row.area.cards.length} {row.area.cards.length === 1 ? "card" : "cards"} ·{" "}
          {row.due ? `${String(row.due)} due` : "Nothing due"}
          {row.suggested ? " · Follow-up available" : ""}
        </Text>
      </View>
      {row.due > 0 && (
        <NativeButton
          label="Review"
          variant="secondary"
          disabled={disabled || row.due === 0}
          onPress={() => {
            onOpen("review");
          }}
        />
      )}
    </View>
  );
}
