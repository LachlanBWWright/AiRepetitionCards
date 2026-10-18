import { Text, View } from "react-native";
import { NativeButton } from "../ui/NativeButton";

type Recommendation = {
  readonly activity: { readonly id: string; readonly areaId: string; readonly title: string };
  readonly estimatedMinutes: number;
  readonly reason: string;
};

export function NativeDeepPracticeRecommendations({
  recommendations,
  disabled,
  onStart,
}: {
  readonly recommendations: readonly Recommendation[];
  readonly disabled: boolean;
  readonly onStart: (areaId: string, activityId: string) => void;
}) {
  if (recommendations.length === 0) return null;
  return (
    <View className="mt-5 gap-3">
      <Text className="text-xl font-bold">Deeper practice</Text>
      <Text className="text-sm text-recall-muted">
        Longer activities build evidence beyond quick recall reviews.
      </Text>
      {recommendations.map((recommendation) => (
        <View
          key={recommendation.activity.id}
          className="gap-2 rounded-xl border border-recall-line p-4"
        >
          <Text className="font-bold">{recommendation.activity.title}</Text>
          <Text className="text-sm text-recall-muted">
            About {recommendation.estimatedMinutes} minutes · {recommendation.reason}
          </Text>
          <NativeButton
            label="Start activity"
            tone="soft"
            disabled={disabled}
            onPress={() => {
              onStart(recommendation.activity.areaId, recommendation.activity.id);
            }}
          />
        </View>
      ))}
    </View>
  );
}
