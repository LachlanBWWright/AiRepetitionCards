import { NativeInsightsSection } from "./NativeInsightsSection";
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
  const [chart, setChart] = useState("activity");
  const [details, setDetails] = useState(false);
  const [simulator, setSimulator] = useState(false);
  const stats = studyStatistics(
    workspace,
    now,
    studyCalendar(now, Number(days), 30, workspace.schedulerSettings?.studyDayStartHour),
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
    <View className="gap-6 border-t border-recall-line py-6">
      <Text className="text-lg font-bold text-recall-ink">Study statistics</Text>
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
      {!rows.some((row) => row.count > 0) && (
        <Text className="text-recall-muted">No recorded values in this range.</Text>
      )}
      {rows
        .filter((row) => row.count > 0)
        .map((row) => (
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
      <View className="gap-2">
        <Text className="text-lg font-bold text-recall-ink">Recall success</Text>
        <Text className="text-2xl font-bold text-recall-ink">
          {stats.trueRetention === null
            ? "No attempts yet"
            : `${(stats.trueRetention * 100).toFixed(0)}%`}
        </Text>
        <Text className="text-sm text-recall-muted">
          {stats.calendar.reduce((sum, day) => sum + day.retentionPasses, 0)} successful recalls
          from {stats.retentionAttempts} first daily attempts. Again counts as a miss; Hard, Good
          and Easy count as successful recalls.
        </Text>
      </View>
      <Text className="font-bold text-recall-ink">Upcoming reviews · next 7 days</Text>
      {stats.forecast.slice(0, 7).map((day) => (
        <Text key={day.label}>
          {day.label}: {day.count} scheduled
        </Text>
      ))}
      <Text className="text-sm text-recall-muted">
        Existing scheduled dates, separate from the history filter. {stats.overdue} overdue cards
        are not included. New cards and future reviews are not predicted.
      </Text>
      <NativeInsightsSection
        open={details}
        title="Memory and study"
        description="Estimated memory, recorded study time and scheduled cards."
        onToggle={() => {
          setDetails(!details);
        }}
      >
        <View className="gap-4">
          <Text>
            Estimated remembered: about {Math.round(stats.estimatedRemembered)} · Average daily
            load: {stats.dailyLoad.toFixed(1)}
          </Text>
          <Text>
            Recorded study time: {(stats.elapsedMs / 60_000).toFixed(1)} min from{" "}
            {stats.timedReviews} timed reviews
          </Text>
          <Text>
            {stats.newCards} new · {stats.learningCards} learning · {stats.reviewCards} review ·{" "}
            {stats.suspendedCards} suspended · {stats.overdue} overdue
          </Text>
          <Text className="text-sm text-recall-muted">
            Retention counts the first answer per card per local day. The forecast shows existing
            due dates, excludes new/suspended cards, and does not predict new reviews or future
            failures.
          </Text>
        </View>
      </NativeInsightsSection>
      <NativeInsightsSection
        open={simulator}
        title="Workload simulator"
        description="Compare study targets and estimated daily workload."
        onToggle={() => {
          setSimulator(!simulator);
        }}
      >
        {
          <NativeStudyPlanner
            workspace={workspace}
            now={now}
            areaId={scope === "all" ? undefined : scope}
          />
        }
      </NativeInsightsSection>
    </View>
  );
}
