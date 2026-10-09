import { NativeButton } from "./ui/NativeButton";
import { useState } from "react";
import { Text, View } from "react-native";
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
    <View className={"gap-[12px] py-[18px] border-t border-recall-line"}>
      <NativeButton
        tone="soft"
        label={expanded ? "Hide review history" : "View review history"}
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded && (
        <>
          <Text className={"text-recall-ink text-[14px]"}>
            {today.inWindow} reviewed today · {week.inWindow} in the last 7 days
          </Text>
          <Text className={"text-recall-ink text-[16px] font-bold"}>Last 7 days</Text>
          <Text className={"text-recall-ink text-[14px]"}>
            {(["again", "hard", "good", "easy"] as const)
              .map((rating) => `${ratingLabels[rating]} ${week.ratings[rating]}`)
              .join(" · ")}
          </Text>
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            {today.total} recorded reviews in this library.
          </Text>
          {workspace.reviews > today.total && (
            <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
              Daily counts cover reviews with a recorded date.
            </Text>
          )}
          <Text className={"text-recall-ink text-[16px] font-bold"}>Recent reviews</Text>
          {recent.length === 0 && (
            <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
              Your first review will appear here after it saves.
            </Text>
          )}
          {recent.map((event) => {
            const area = workspace.areas.find((item) => item.id === event.areaId);
            const card = area?.cards.find((item) => item.id === event.cardId);
            return (
              <View key={event.id} className={"gap-[4px] border-t border-recall-line pt-[12px]"}>
                <Text className={"text-recall-ink text-[14px] font-semibold"}>
                  {card?.front ?? "Deleted card"}
                </Text>
                <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                  {area?.title ?? "Deleted learning area"} · {ratingLabels[event.rating]}
                </Text>
                <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
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
            <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
              Latest 20 reviews.
            </Text>
          )}
        </>
      )}
    </View>
  );
}
