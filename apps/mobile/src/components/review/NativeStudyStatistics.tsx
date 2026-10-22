import { NativeStudyPlanner } from "./NativeStudyPlanner";
import { useState } from "react";
import { Text, View } from "react-native";
import type { Workspace } from "@recall/domain";
import { studyCalendar, studyStatistics } from "@recall/application";
import { NativeSelect } from "@recall/ui-native";

export function NativeStudyStatistics({
  workspace,
  now,
  areaId,
}: {
  readonly workspace: Workspace;
  readonly now: number;
  readonly areaId?: string | undefined;
}) {
  const [scope, setScope] = useState(areaId ?? "all");
  const [days, setDays] = useState("30");
  const [chart, setChart] = useState("forecast");
  const stats = studyStatistics(
    workspace,
    now,
    studyCalendar(now, Number(days), 30),
    scope === "all" ? undefined : scope,
  );
  const rows =
    chart === "time"
      ? stats.calendar.map((day) => ({
          label: day.label,
          count: Math.round(day.elapsedMs / 600) / 100,
        }))
      : chart === "forecast"
        ? stats.forecast.map((day) => ({ label: day.label, count: day.count }))
        : chart === "activity"
          ? stats.calendar.map((day) => ({ label: day.label, count: day.reviews }))
          : chart === "intervals"
            ? stats.intervals
            : chart === "stability"
              ? stats.stability
              : chart === "difficulty"
                ? stats.difficulty
                : stats.retrievability;
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  return (
    <View className="gap-3 border-t border-recall-line py-4">
      <Text className="text-lg font-bold text-recall-ink">Study statistics</Text>
      <NativeStudyPlanner
        workspace={workspace}
        now={now}
        areaId={scope === "all" ? undefined : scope}
      />
      <NativeSelect
        label="Subject"
        value={scope}
        options={[
          { label: "All subjects", value: "all" },
          ...workspace.areas.map((area) => ({ label: area.title, value: area.id })),
        ]}
        onValueChange={setScope}
      />
      <NativeSelect
        label="History"
        value={days}
        options={[7, 30, 90, 365].map((value) => ({
          label: `Last ${String(value)} days`,
          value: String(value),
        }))}
        onValueChange={setDays}
      />
      <Text>
        True retention:{" "}
        {stats.trueRetention === null ? "No data" : `${(stats.trueRetention * 100).toFixed(1)}%`} (
        {stats.retentionAttempts} first daily answers)
      </Text>
      <Text>
        Estimated remembered: {stats.estimatedRemembered.toFixed(1)} · Average daily load:{" "}
        {stats.dailyLoad.toFixed(1)}
      </Text>
      <Text>
        Recorded study time: {(stats.elapsedMs / 60_000).toFixed(1)} min from {stats.timedReviews}{" "}
        timed reviews
      </Text>
      <Text>
        {stats.newCards} new · {stats.learningCards} learning · {stats.reviewCards} review ·{" "}
        {stats.suspendedCards} suspended · {stats.overdue} overdue
      </Text>
      <Text className="text-sm text-recall-muted">
        Retention counts the first answer per card per local day. The forecast shows existing due
        dates, excludes new/suspended cards, and does not predict new reviews or future failures.
      </Text>
      <NativeSelect
        label="Chart"
        value={chart}
        options={[
          { label: "Upcoming due dates · 30 days", value: "forecast" },
          { label: "Review activity", value: "activity" },
          { label: "Recorded time · minutes", value: "time" },
          { label: "Intervals · days", value: "intervals" },
          { label: "Stability · days", value: "stability" },
          { label: "Difficulty", value: "difficulty" },
          { label: "Estimated recall · percent", value: "recall" },
        ]}
        onValueChange={setChart}
      />
      {rows.map((row) => (
        <View key={row.label} className="gap-1">
          <Text className="text-sm text-recall-ink">
            {row.label}: {row.count}
          </Text>
          <View className="h-2 rounded bg-recall-line">
            <View
              className="h-2 rounded bg-recall-darkGreen"
              style={{ width: `${String((row.count / maximum) * 100)}%` as `${number}%` }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
