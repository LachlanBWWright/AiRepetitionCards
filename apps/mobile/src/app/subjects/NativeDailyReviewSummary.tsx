import { dailyReviewCopy } from "@recall/application";
import { View, Text } from "react-native";
import { NativeButton } from "@recall/ui-native";

export function NativeDailyReviewSummary({
  due,
  disabled,
  onReview,
}: {
  readonly due: number;
  readonly disabled: boolean;
  readonly onReview: () => void;
}) {
  const copy = dailyReviewCopy(due);
  return (
    <View className="flex-row items-center gap-4 border-b border-recall-line pb-4">
      <View className="flex-1 gap-1">
        <Text accessibilityRole="header" className="text-lg font-semibold text-recall-ink">
          {copy.title}
        </Text>
        {due === 0 && (
          <Text className="text-sm leading-6 text-recall-muted">{copy.description}</Text>
        )}
      </View>
      {due > 0 && <NativeButton label="Review all due" disabled={disabled} onPress={onReview} />}
    </View>
  );
}
