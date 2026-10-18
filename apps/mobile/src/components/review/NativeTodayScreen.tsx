import { NativeButton } from "../ui/NativeButton";
import { Card } from "../../../components/ui/card";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { designTokens } from "@recall/design-tokens";
import type { Workspace, Assessment, ReviewEvent } from "@recall/domain";
import { previewReviewSchedules, type ReviewRating } from "@recall/scheduler";
import { Effect, Either } from "effect";
import { useState, type ReactNode } from "react";
import { summarizeReviews, summarizeStudySession, formatReviewDelay } from "@recall/application";
import { NativeTodayScreenReviewCard } from "./NativeTodayScreenReviewCard";
import { DeckChoiceButton, DecksSection, FlaggedCardsAction } from "./NativeTodayScreenDecks";

const palette = designTokens.color;

function dueNow(card: Assessment, now: number): boolean {
  return Date.parse(card.schedule.due) <= now;
}

export type NativeTodayScreenProps = {
  readonly embedded?: boolean;
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
  embedded = false,
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
  const reviewDelays =
    preview && Either.isRight(preview)
      ? {
          again: formatReviewDelay(preview.right.again.due, now),
          hard: formatReviewDelay(preview.right.hard.due, now),
          good: formatReviewDelay(preview.right.good.due, now),
          easy: formatReviewDelay(preview.right.easy.due, now),
        }
      : {};
  const chooseDeck = (areaId: string) => {
    onSelectArea(areaId);
    onHideAnswer();
    setChoosingArea(false);
  };
  const emptyStateTitle = !activeArea
    ? "Create your first subject"
    : activeArea.cards.length === 0
      ? "Build your subject"
      : session && session.reviewed > 0
        ? `You’re caught up in ${activeArea.title}`
        : "Already caught up";
  const emptyStateDescription =
    !activeArea || activeArea.cards.length === 0
      ? "Add cards in Overview to start studying."
      : session && session.reviewed > 0
        ? `${String(session.reviewed)} ${session.reviewed === 1 ? "review" : "reviews"} this session · ${String(session.recalled)} recalled.`
        : "No cards due right now.";
  const deckChoiceRows = workspace.areas.map((area) => (
    <DeckChoiceButton
      key={area.id}
      area={area}
      selected={area.id === activeArea?.id}
      dueCount={area.cards.filter((item) => dueNow(item, now)).length}
      reviewPending={reviewPending}
      onSelect={chooseDeck}
    />
  ));

  return (
    <SafeAreaView
      edges={embedded ? [] : ["top"]}
      testID="mobile-screen"
      className={"flex-1 bg-recall-paper"}
    >
      <ScrollView contentContainerClassName="w-full max-w-[720px] self-center px-[22px] pt-[16px] pb-[48px]">
        <View className={embedded ? "hidden" : "flex-row items-end justify-between mb-[20px]"}>
          <Text
            className={"text-recall-ink text-[40px] leading-[48px] font-bold tracking-[-1.7px]"}
          >
            Review
          </Text>
          <Text className={"text-recall-muted text-[13px] pb-[7px]"}>{displayedDate}</Text>
        </View>

        {!embedded && workspace.areas.length > 1 && (
          <View className={"mb-[8px]"}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Deck: ${activeArea?.title ?? "Choose deck"}`}
              accessibilityState={{ expanded: choosingArea, disabled: reviewPending }}
              disabled={reviewPending}
              onPress={() => {
                setChoosingArea((value) => !value);
              }}
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
            {choosingArea && deckChoiceRows}
          </View>
        )}
        <Text className={"text-recall-muted text-[14px] mb-[8px]"}>
          {session
            ? `${String(session.reviewed)} reviewed this session · ${String(session.remaining)} remaining`
            : `${String(totalDue)} due`}{" "}
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
            <NativeTodayScreenReviewCard
              card={card}
              flagged={flaggedCardIds.includes(card.id)}
              {...(onFlag ? { onFlag } : {})}
              showAnswer={showAnswer}
              reviewPending={reviewPending}
              mediaUris={mediaUris}
              reviewDelays={reviewDelays}
              ratingColors={{
                again: palette.coral,
                hard: palette.amber,
                good: palette.green,
                easy: palette.violet,
              }}
              onReview={onReview}
              onShowAnswer={onShowAnswer}
            />
          </View>
        ) : (
          <Card className="mt-5 gap-3 p-5">
            <Text accessibilityLiveRegion="polite" className="text-xl font-bold text-recall-ink">
              {emptyStateTitle}
            </Text>
            <Text className="text-sm text-recall-muted">{emptyStateDescription}</Text>
            {session?.nextReviewAt && (
              <Text className="text-sm text-recall-muted">
                Next review: {new Date(session.nextReviewAt).toLocaleString()}
              </Text>
            )}
            {activeArea && onEditFlagged && (
              <FlaggedCardsAction
                area={activeArea}
                flaggedCardIds={flaggedCardIds}
                onEdit={onEditFlagged}
              />
            )}
            {nextDeck && onNextDeck && (
              <NativeButton
                label={`Review next subject · ${nextDeck.title}`}
                disabled={reviewPending}
                onPress={onNextDeck}
              />
            )}
          </Card>
        )}

        {deepPractice}
        {onOpenLibrary ? (
          <NativeButton
            label={activeArea?.cards.length ? "Back to Overview" : "Add cards in Overview"}
            tone="soft"
            onPress={onOpenLibrary}
          />
        ) : (
          <>
            {authoringPanel}
            {tutorPanel}

            <DecksSection
              workspace={workspace}
              now={now}
              reviewPending={reviewPending}
              onSelectArea={onSelectArea}
              onHideAnswer={onHideAnswer}
              onImportAnki={onImportAnki}
              onReset={onReset}
              canReset={canReset}
            />
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
