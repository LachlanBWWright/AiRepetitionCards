import { useStudyPlanner } from "@recall/react";
import type { Workspace } from "@recall/domain";
import { Text, View } from "react-native";
import { NativeTextField } from "@recall/ui-native";
import { NativeButton } from "../ui/NativeButton";
export function NativeStudyPlanner({
  workspace,
  now,
  areaId,
}: {
  readonly workspace: Workspace;
  readonly now: number;
  readonly areaId?: string | undefined;
}) {
  const planner = useStudyPlanner(workspace, now, areaId);
  return (
    <View className="gap-4 border-t py-4">
      <Text className="font-bold">Workload simulator</Text>
      <Text>
        Seeded estimate of repeat reviews, forgetting and time. Uses your study-day boundary,
        sibling-burying policy and reduced-load weekdays.
      </Text>
      {planner.fields.map((field) => (
        <NativeTextField
          key={field.label}
          label={field.label}
          value={field.value}
          onChangeText={field.set}
          keyboardType="numeric"
        />
      ))}
      <NativeButton label="Simulate workload" variant="default" onPress={planner.run} />
      {planner.message ? <Text accessibilityLiveRegion="polite">{planner.message}</Text> : null}
      {planner.comparisons.map((scenario) => (
        <Text key={scenario.targetRetention}>
          {Math.round(scenario.targetRetention * 100)}% target: {scenario.totalReviews} answers ·{" "}
          {scenario.totalMinutes.toFixed(0)} min · final predicted recall{" "}
          {scenario.expectedRetention === null
            ? "unavailable"
            : `${(scenario.expectedRetention * 100).toFixed(1)}%`}
        </Text>
      ))}
      {planner.result && (
        <>
          <Text>
            {planner.result.totalReviews} answers · {planner.result.totalMinutes.toFixed(0)}{" "}
            minutes. {planner.result.averageSeconds.toFixed(1)} seconds/answer (
            {planner.result.timingEstimated ? "estimate" : "recorded"}).
          </Text>
          {planner.result.assumptions.map((assumption) => (
            <Text key={assumption}>{assumption}</Text>
          ))}
          {planner.result.days.map((day) => (
            <Text key={day.day}>
              Day {day.day}: {day.reviews} answers · {day.minutes.toFixed(1)} min · {day.backlog}{" "}
              overdue · {day.buried} buried siblings
            </Text>
          ))}
        </>
      )}
    </View>
  );
}
