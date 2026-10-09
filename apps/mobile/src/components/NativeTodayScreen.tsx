import { NativeButton } from "./ui/NativeButton";
import { Card } from "../../components/ui/card";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { designTokens } from "@recall/design-tokens";
import { NativeAudioAttachment } from "./NativeAudioAttachment";
import type { Workspace, Assessment } from "@recall/domain";
import type { ReviewRating } from "@recall/scheduler";
import { useState, type ReactNode } from "react";
import { summarizeReviews } from "@recall/application";

const palette = designTokens.color;

function dueNow(card: Assessment, now: number): boolean {
  return Date.parse(card.schedule.due) <= now;
}

export type NativeTodayScreenProps = {
  readonly ready: boolean;
  readonly workspace: Workspace | null;
  readonly activeAreaId: string | null;
  readonly now: number;
  readonly dateLabel?: string;
  readonly message: string | null;
  readonly mediaUris?: Readonly<Record<string, string>>;
  readonly showAnswer: boolean;
  readonly canReset: boolean;
  readonly reviewPending?: boolean;
  readonly onSelectArea: (areaId: string) => void;
  readonly onHideAnswer: () => void;
  readonly onShowAnswer: () => void;
  readonly onReview: (rating: ReviewRating) => void;
  readonly onReset: () => void;
  readonly onImportAnki: () => void;
  readonly onOpenLibrary?: () => void;
  readonly tutorPanel?: ReactNode;
  readonly authoringPanel?: ReactNode;
};

export function NativeTodayScreen({
  ready,
  workspace,
  activeAreaId,
  now,
  dateLabel,
  message,
  mediaUris = {},
  showAnswer,
  canReset,
  reviewPending = false,
  onSelectArea,
  onHideAnswer,
  onShowAnswer,
  onReview,
  onReset,
  onImportAnki,
  onOpenLibrary,
  tutorPanel,
  authoringPanel,
}: NativeTodayScreenProps) {
  const [choosingArea, setChoosingArea] = useState(false);
  if (!ready || !workspace) {
    return (
      <SafeAreaView
        edges={["top"]}
        className={"flex-1 items-center justify-center gap-[16px] bg-recall-paper"}
      >
        <ActivityIndicator color={palette.darkGreen} size="large" />
        <Text className={"text-recall-muted text-[13px]"}>Loading library…</Text>
      </SafeAreaView>
    );
  }

  const activeArea = workspace.areas.find((area) => area.id === activeAreaId) ?? workspace.areas[0];
  const dueCards = activeArea?.cards.filter((item) => dueNow(item, now)) ?? [];
  const card = dueCards[0];
  const totalDue = activeArea?.cards.filter((item) => dueNow(item, now)).length ?? 0;
  const date = new Date(now);
  const totalReviews = summarizeReviews(
    [...new Map((workspace.reviewEvents ?? []).map((event) => [event.id, event])).values()],
    new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    date,
  ).inWindow;
  const retainedCards = (workspace.retainedReviewAreas ?? []).flatMap((area) => area.cards).length;
  const displayedDate =
    dateLabel ??
    new Date(now).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  return (
    <SafeAreaView edges={["top"]} testID="mobile-screen" className={"flex-1 bg-recall-paper"}>
      <ScrollView contentContainerClassName="w-full max-w-[720px] self-center px-[22px] pt-[16px] pb-[48px]">
        <View className={"flex-row items-end justify-between mb-[20px]"}>
          <Text
            className={"text-recall-ink text-[40px] leading-[48px] font-bold tracking-[-1.7px]"}
          >
            Today
          </Text>
          <Text className={"text-recall-muted text-[13px] pb-[7px]"}>{displayedDate}</Text>
        </View>

        {workspace.areas.length > 1 && (
          <View className={"mb-[8px]"}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Study area: ${activeArea?.title ?? "Choose area"}`}
              accessibilityState={{ expanded: choosingArea, disabled: reviewPending }}
              disabled={reviewPending}
              onPress={() => setChoosingArea((value) => !value)}
              className={
                "flex-row items-center border-t-recall-line border-t py-[12px] justify-between"
              }
            >
              <Text className={"text-recall-ink text-[13px] font-semibold"}>
                {activeArea?.title ?? "Choose area"}
              </Text>
              <Text className={"text-recall-muted text-[24px] mt-[-3px]"}>
                {choosingArea ? "⌃" : "⌄"}
              </Text>
            </Pressable>
            {choosingArea &&
              workspace.areas.map((area) => (
                <Pressable
                  key={area.id}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: area.id === activeArea?.id,
                    disabled: reviewPending,
                  }}
                  disabled={reviewPending}
                  onPress={() => {
                    onSelectArea(area.id);
                    onHideAnswer();
                    setChoosingArea(false);
                  }}
                  className={
                    "flex-row items-center border-t-recall-line border-t py-[12px] justify-between"
                  }
                >
                  <Text className={"text-recall-ink text-[13px] font-semibold"}>{area.title}</Text>
                  <Text className={"text-recall-muted text-[10px] mr-[12px]"}>
                    {area.cards.filter((item) => dueNow(item, now)).length} due
                  </Text>
                </Pressable>
              ))}
          </View>
        )}
        <Text className={"text-recall-muted text-[14px] mb-[8px]"}>
          {totalDue} due · {totalReviews} reviewed today
        </Text>

        {message && (
          <Text
            accessibilityRole="alert"
            className={
              "text-recall-darkGreen text-[12px] bg-recall-paper rounded-[12px] p-[12px] mt-[14px] leading-[18px]"
            }
          >
            {message}
          </Text>
        )}

        {card ? (
          <View className={"mt-[16px]"}>
            {workspace.areas.length <= 1 && (
              <Text className={"text-recall-ink text-[17px] font-bold tracking-[-0.3px]"}>
                {activeArea?.title ?? "Study"}
              </Text>
            )}
            <Card
              className={
                "rounded-[12px] bg-recall-surface border border-recall-line p-[23px] min-h-[260px] justify-between"
              }
            >
              <View className={"flex-row justify-between items-center"}>
                <Text className={"text-recall-muted text-[12px]"}>
                  {showAnswer ? "Answer" : "Question"}
                </Text>
              </View>
              <Text className={"text-recall-ink text-[23px] leading-[32px] font-medium my-[28px]"}>
                {showAnswer ? card.back : card.front}
              </Text>
              {card.media?.map((reference) => {
                const uri = mediaUris[reference.id];
                if (!uri) return null;
                return reference.mimeType.startsWith("image/") ? (
                  <Image
                    key={reference.id}
                    source={{ uri }}
                    accessibilityLabel="Study card image attachment"
                    alt="Study card image attachment"
                    resizeMode="contain"
                    className={"w-full h-[220px] rounded-[14px] my-[18px] bg-recall-green"}
                  />
                ) : (
                  <NativeAudioAttachment key={reference.id} uri={uri} />
                );
              })}
              {reviewPending && (
                <Text accessibilityLiveRegion="polite" className={"text-recall-muted text-[13px]"}>
                  Saving review…
                </Text>
              )}
              {showAnswer ? (
                <View className={"flex-row flex-wrap gap-[8px]"}>
                  {(
                    [
                      ["again", "Again", palette.coral],
                      ["hard", "Hard", palette.amber],
                      ["good", "Good", palette.green],
                      ["easy", "Easy", palette.violet],
                    ] as const
                  ).map(([rating, label, color]) => (
                    <Pressable
                      key={rating}
                      accessibilityRole="button"
                      disabled={reviewPending}
                      accessibilityState={{ disabled: reviewPending, busy: reviewPending }}
                      onPress={() => onReview(rating)}
                      className={`${"grow basis-[45%] items-center justify-center min-h-[47px] rounded-[14px]"}`}
                      style={[{ backgroundColor: color, opacity: reviewPending ? 0.5 : 1 }]}
                    >
                      <Text className={"text-recall-ink text-[13px] font-bold"}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <NativeButton
                  label="Show answer"
                  disabled={reviewPending}
                  onPress={() => onShowAnswer()}
                />
              )}
            </Card>
          </View>
        ) : (
          <Text
            accessibilityLiveRegion="polite"
            className={"text-recall-muted text-[15px] mt-[20px] mb-[12px]"}
          >
            {activeArea
              ? "You’re all caught up."
              : "Create a learning area in Library to get started."}
          </Text>
        )}

        {onOpenLibrary ? (
          <NativeButton label="Open Library" tone="soft" onPress={onOpenLibrary} />
        ) : (
          <>
            {authoringPanel}
            {tutorPanel}

            <View className={"mt-[31px]"}>
              <View className={"flex-row justify-between items-center mb-[13px]"}>
                <Text className={"text-recall-ink text-[17px] font-bold tracking-[-0.3px]"}>
                  Learning areas
                </Text>
                <Text className={"text-recall-muted text-[9px] font-extrabold tracking-[1.1px]"}>
                  {workspace?.areas.length ?? 0} AREAS
                </Text>
              </View>
              {workspace?.areas.map((area) => {
                const areaDue = area.cards.filter((item) => dueNow(item, now)).length;
                return (
                  <Pressable
                    key={area.id}
                    disabled={reviewPending}
                    accessibilityState={{ disabled: reviewPending }}
                    onPress={() => {
                      onSelectArea(area.id);
                      onHideAnswer();
                    }}
                    className={
                      "flex-row items-center border-t-recall-line border-t py-[12px] justify-between"
                    }
                  >
                    <View
                      className={`${"h-[35px] w-[5px] rounded-[4px] mr-[12px]"}`}
                      style={[{ backgroundColor: area.color }]}
                    />
                    <View className={"flex-1"}>
                      <Text className={"text-recall-ink text-[13px] font-semibold"}>
                        {area.title}
                      </Text>
                      <Text className={"text-recall-muted text-[10px] mt-[3px]"}>
                        {area.cards.length} cards
                      </Text>
                    </View>
                    <Text className={"text-recall-muted text-[10px] mr-[12px]"}>{areaDue} due</Text>
                    <Text className={"text-recall-muted text-[24px] mt-[-3px]"}>›</Text>
                  </Pressable>
                );
              })}
              <NativeButton
                label="Import Anki deck"
                onPress={onImportAnki}
                tone="soft"
                disabled={reviewPending}
              />
              <NativeButton
                label="Reset local study data"
                onPress={onReset}
                tone="soft"
                disabled={!canReset || reviewPending}
              />
            </View>
          </>
        )}
        {retainedCards > 0 && (
          <View className={"mt-[31px]"}>
            <Text className={"text-recall-ink text-[13px] font-semibold"}>Sync needed</Text>
            <Text className={"text-recall-muted text-[10px] text-center leading-[16px] mt-[29px]"}>
              Sync to finish deleting {retainedCards} card{retainedCards === 1 ? "" : "s"}.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
