import { NativeButton } from "./ui/NativeButton";
import { Card } from "../../components/ui/card";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { designTokens } from "@recall/design-tokens";
import { NativeAudioAttachment } from "./NativeAudioAttachment";
import type { Workspace, Assessment, ReviewEvent } from "@recall/domain";
import { previewReviewSchedules, type ReviewRating } from "@recall/scheduler";
import { Effect, Either } from "effect";
import { useState, type ReactNode } from "react";
import { summarizeReviews, summarizeStudySession, formatReviewDelay } from "@recall/application";

const palette = designTokens.color;

function dueNow(card: Assessment, now: number): boolean {
  return Date.parse(card.schedule.due) <= now;
}

export type NativeTodayScreenProps = {
  readonly deepPractice?: ReactNode;
  readonly flaggedCardIds?: readonly string[];
  readonly onFlag?: (id: string) => void;
  readonly onEditFlagged?: () => void;
  readonly sessionEvents?: readonly ReviewEvent[];
  readonly onNextDeck?: () => void;
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
  deepPractice,
  sessionEvents = [],
  flaggedCardIds = [],
  onFlag,
  onEditFlagged,
  onNextDeck,
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
  const session = activeArea ? summarizeStudySession(activeArea, sessionEvents, now) : null;
  const preview = card
    ? Effect.runSync(
        Effect.either(
          previewReviewSchedules(card.schedule, new Date(now), workspace.schedulerSettings),
        ),
      )
    : null;
  const nextDeck = workspace.areas.find(
    (area) => area.id !== activeArea?.id && area.cards.some((item) => dueNow(item, now)),
  );
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
              accessibilityLabel={`Deck: ${activeArea?.title ?? "Choose deck"}`}
              accessibilityState={{ expanded: choosingArea, disabled: reviewPending }}
              disabled={reviewPending}
              onPress={() => setChoosingArea((value) => !value)}
              className={
                "flex-row items-center border-t-recall-line border-t py-[12px] justify-between"
              }
            >
              <Text className={"text-recall-ink text-[13px] font-semibold"}>
                {activeArea?.title ?? "Choose deck"}
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
          {session
            ? `${session.reviewed} reviewed this session · ${session.remaining} remaining`
            : `${totalDue} due`}{" "}
          · {totalReviews} reviewed today
        </Text>

        {session && card && (
          <Text className="text-sm text-recall-muted">
            {session.newCards} new · {session.learningCards} learning ·{" "}
            {session.remaining - session.newCards - session.learningCards} review
          </Text>
        )}
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
            {onFlag && (
              <NativeButton
                label={flaggedCardIds.includes(card.id) ? "Flagged for editing" : "Improve later"}
                tone="soft"
                disabled={reviewPending}
                onPress={() => onFlag(card.id)}
              />
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
                <View className="gap-3">
                  <Text className="text-sm text-recall-muted">
                    Again: forgot · Hard: recalled with difficulty · Good: recalled · Easy:
                    effortless
                  </Text>
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
                        <Text className={"text-recall-ink text-[15px] font-bold"}>{label}</Text>
                        {preview && Either.isRight(preview) && (
                          <Text className="text-sm text-recall-ink">
                            {formatReviewDelay(preview.right[rating].due, now)}
                          </Text>
                        )}
                      </Pressable>
                    ))}
                  </View>
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
          <Card className="mt-5 gap-3 p-5">
            <Text accessibilityLiveRegion="polite" className="text-xl font-bold text-recall-ink">
              {!activeArea
                ? "Create your first deck"
                : activeArea.cards.length === 0
                  ? "Build your deck"
                  : session && session.reviewed > 0
                    ? `You’re caught up in ${activeArea.title}`
                    : "Already caught up"}
            </Text>
            <Text className="text-sm text-recall-muted">
              {!activeArea || activeArea.cards.length === 0
                ? "Add cards in Library to start studying."
                : session && session.reviewed > 0
                  ? `${session.reviewed} ${session.reviewed === 1 ? "review" : "reviews"} this session · ${session.recalled} recalled.`
                  : "No cards due right now."}
            </Text>
            {session?.nextReviewAt && (
              <Text className="text-sm text-recall-muted">
                Next review: {new Date(session.nextReviewAt).toLocaleString()}
              </Text>
            )}
            {activeArea &&
              onEditFlagged &&
              activeArea.cards.some((entry) => flaggedCardIds.includes(entry.id)) && (
                <NativeButton
                  label={`Edit flagged cards (${activeArea.cards.filter((entry) => flaggedCardIds.includes(entry.id)).length})`}
                  tone="soft"
                  onPress={onEditFlagged}
                />
              )}
            {nextDeck && onNextDeck && (
              <NativeButton
                label={`Review next deck · ${nextDeck.title}`}
                disabled={reviewPending}
                onPress={onNextDeck}
              />
            )}
          </Card>
        )}

        {deepPractice}
        {onOpenLibrary ? (
          <NativeButton
            label={activeArea?.cards.length ? "Back to Library" : "Add cards in Library"}
            tone="soft"
            onPress={onOpenLibrary}
          />
        ) : (
          <>
            {authoringPanel}
            {tutorPanel}

            <View className={"mt-[31px]"}>
              <View className={"flex-row justify-between items-center mb-[13px]"}>
                <Text className={"text-recall-ink text-[17px] font-bold tracking-[-0.3px]"}>
                  Decks
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
