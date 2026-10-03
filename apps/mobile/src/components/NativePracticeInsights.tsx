import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { NativeButton } from "@recall/ui-native";
import { designTokens } from "@recall/design-tokens";
import { summarizeReviews } from "@recall/application";
import type { Workspace } from "@recall/domain";

export type NativePracticeInsightsProps = {
  readonly workspace: Workspace;
  readonly now: number;
  readonly initiallyExpanded?: boolean;
};
/** Calendar boundaries belong to this platform; shared counting uses immutable review history. */
export function NativePracticeInsights({
  workspace,
  now,
  initiallyExpanded = false,
}: NativePracticeInsightsProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const date = new Date(now);
  const events = [
    ...new Map((workspace.reviewEvents ?? []).map((event) => [event.id, event])).values(),
  ];
  const today = summarizeReviews(
    events,
    new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    date,
  );
  const week = summarizeReviews(
    events,
    new Date(date.getFullYear(), date.getMonth(), date.getDate() - 6),
    date,
  );
  const recent = [...events]
    .sort(
      (left, right) =>
        Date.parse(right.ratedAt) - Date.parse(left.ratedAt) ||
        left.id.localeCompare(right.id, "en"),
    )
    .slice(0, 20);
  const ratingLabels = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" } as const;
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Your practice</Text>
      <Text style={styles.summary}>
        {today.inWindow} today · {week.inWindow} in the last 7 days
      </Text>
      <NativeButton
        tone="soft"
        label={expanded ? "Hide review history" : "View review history"}
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded && (
        <>
          <Text style={styles.hint}>
            Across all learning areas. Counts come from recorded reviews, including deleted cards.
          </Text>
          <Text style={styles.heading}>Last 7 days</Text>
          <Text style={styles.summary}>
            {(["again", "hard", "good", "easy"] as const)
              .map((rating) => `${ratingLabels[rating]} ${week.ratings[rating]}`)
              .join(" · ")}
          </Text>
          <Text style={styles.hint}>{today.total} recorded reviews in this library.</Text>
          {workspace.reviews > today.total && (
            <Text style={styles.hint}>
              Older review totals without individual events are excluded from daily counts and
              history.
            </Text>
          )}
          <Text style={styles.heading}>Recent reviews</Text>
          {recent.length === 0 && (
            <Text style={styles.hint}>Your first review will appear here after it saves.</Text>
          )}
          {recent.map((event) => {
            const area = workspace.areas.find((item) => item.id === event.areaId);
            const card = area?.cards.find((item) => item.id === event.cardId);
            return (
              <View key={event.id} style={styles.review}>
                <Text style={styles.card}>{card?.front ?? "Deleted card"}</Text>
                <Text style={styles.hint}>
                  {area?.title ?? "Deleted learning area"} · {ratingLabels[event.rating]}
                </Text>
                <Text style={styles.hint}>
                  {Number.isFinite(Date.parse(event.ratedAt))
                    ? new Intl.DateTimeFormat("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "UTC",
                      }).format(new Date(event.ratedAt)) + " UTC"
                    : "Time unavailable"}
                </Text>
              </View>
            );
          })}
          {events.length > 20 && (
            <Text style={styles.hint}>
              Showing the latest 20 reviews. Export a private backup to keep your full history.
            </Text>
          )}
        </>
      )}
    </View>
  );
}
const palette = designTokens.color;
const styles = StyleSheet.create({
  panel: {
    gap: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 20,
    backgroundColor: palette.surface,
  },
  title: { color: palette.ink, fontSize: 22, fontWeight: "700" },
  heading: { color: palette.ink, fontSize: 16, fontWeight: "700" },
  summary: { color: palette.ink, fontSize: 14 },
  hint: { color: palette.muted, fontSize: 12, lineHeight: 18 },
  card: { color: palette.ink, fontSize: 14, fontWeight: "600" },
  review: { gap: 4, borderTopWidth: 1, borderColor: palette.line, paddingTop: 12 },
});
