import { Text, View } from "react-native";
import type { DeckQualityIssue } from "@recall/application";

export function NativeDeckQualityPanel({
  issues,
}: {
  readonly issues: readonly DeckQualityIssue[];
}) {
  const blockers = issues.filter((issue) => issue.severity === "blocking").length;
  return (
    <View className="rounded-2xl border border-recall-line bg-white p-4">
      <Text className="text-base font-bold text-recall-ink">Deck quality</Text>
      <Text className="mt-1 text-xs font-semibold text-recall-muted">
        {blockers > 0
          ? `${String(blockers)} publishing blocker${blockers === 1 ? "" : "s"}`
          : `${String(issues.length)} suggestion${issues.length === 1 ? "" : "s"}`}
      </Text>
      {issues.length === 0 ? (
        <Text className="mt-3 text-sm text-recall-muted">
          No quality issues found. This check does not assess learning mastery.
        </Text>
      ) : (
        issues.map((issue, index) => (
          <Text
            key={`${issue.code}-${issue.cardId ?? issue.activityId ?? String(index)}`}
            className="mt-3 text-sm text-recall-ink"
          >
            {issue.severity === "blocking" ? "Fix before publishing: " : "Review: "}
            {issue.message}
          </Text>
        ))
      )}
    </View>
  );
}
