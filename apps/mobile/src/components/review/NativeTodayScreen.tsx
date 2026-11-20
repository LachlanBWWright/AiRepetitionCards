import { NativeCollapsibleTrigger, NativeCollapsibleContent } from "@recall/ui-native";

import type { LearningActivitiesProps } from "../../hooks/use-learning-activities";
import { NativeReviewActivityCard } from "./activities/NativeReviewActivityCard";
import { nativeReviewDelays, nativeReviewRatingColors } from "./native-review-presentation";
import { NativeReviewCardHelp } from "./assistance/NativeReviewCardHelp";
import type { MediaTrashPurgeResult } from "@recall/application";
import type { MediaReference } from "@recall/domain";
import { effectiveReviewEvents } from "@recall/domain";
import type { WorkspaceStore, MediaStore } from "@recall/local-store";
import { NativeButton } from "../ui/NativeButton";
import { Card } from "../../../components/ui/card";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { designTokens } from "@recall/design-tokens";
import type { Workspace, ReviewEvent } from "@recall/domain";
import type { ReviewRating } from "@recall/scheduler";
import { useState, type ReactNode } from "react";
import {
  localStudyDay,
  studySessionQueue,
  studySessionArea,
  nextStudyArea,
  summarizeStudySubjects,
  summarizeReviews,
  summarizeStudySession,
} from "@recall/application";
import { DeckChoiceButton, DecksSection, FlaggedCardsAction } from "./NativeTodayScreenDecks";
import { NativeCramPractice } from "./NativeCramPractice";
import { NativeAdditionalStudyTools } from "./NativeAdditionalStudyTools";
import type { NativeStudyCommand } from "../../hooks/use-native-study-command";

const palette = designTokens.color;
export type NativeTodayScreenProps = {
  readonly reviewActivities?: LearningActivitiesProps;
  readonly workspaceStore?: WorkspaceStore | undefined;
  readonly onPurged?: ((result: MediaTrashPurgeResult) => void) | undefined;
  readonly protectedReferences?: readonly MediaReference[] | undefined;
  readonly reviewRepairApi?: Parameters<typeof NativeReviewCardHelp>[0]["api"];
  readonly embedded?: boolean;
  readonly deepPractice?: ReactNode;
  readonly flaggedCardIds?: readonly string[];
  readonly onFlag?: (id: string) => void;
  readonly onSuspend?: () => void;
  readonly onStudyCommand?: NativeStudyCommand;
  readonly onEditFlagged?: () => void;
  readonly sessionEvents?: readonly ReviewEvent[];
  readonly onNextDeck?: () => void;
  readonly ready: boolean;
  readonly workspace: Workspace | null;
  readonly activeAreaId: string | null;
  readonly now: number;
  readonly dateLabel?: string;
  readonly message: string | null;
  readonly mediaStore?: MediaStore | null;
  readonly mediaRevision?: number;
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
  reviewActivities,
  protectedReferences,
  workspaceStore,
  onPurged,
  embedded = false,
  reviewRepairApi,
  deepPractice,
  sessionEvents = [],
  flaggedCardIds = [],
  onFlag,
  onSuspend,
  onStudyCommand,
  onEditFlagged,
  onNextDeck,
  ready,
  workspace,
  activeAreaId,
  now,
  dateLabel,
  message,
  mediaStore = null,
  mediaRevision = 0,
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
  const [repairOpen, setRepairOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [choosingArea, setChoosingArea] = useState(false);
  const [cramAreaId, setCramAreaId] = useState<string | null>(null);
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

  const activeArea = studySessionArea(workspace, activeAreaId ?? "", now) ?? workspace.areas[0];
  const queue = activeArea
    ? studySessionQueue(workspace, activeAreaId ?? "", activeArea, now)
    : undefined;
  const dueCards = queue?.cards ?? [];
  const card = dueCards[0];
  const session = activeArea ? summarizeStudySession(activeArea, sessionEvents, now, queue) : null;
  const nextDeck = nextStudyArea(workspace, now, activeArea?.id);
  const totalDue = dueCards.length;
  const date = new Date(now);
  const totalReviews = summarizeReviews(
    [...new Map(effectiveReviewEvents(workspace).map((event) => [event.id, event])).values()],
    new Date(localStudyDay(now, workspace.schedulerSettings?.studyDayStartHour).startsAt),
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
  const reviewDelays = nativeReviewDelays(workspace, activeArea?.id ?? "", card, now);
  const chooseDeck = (areaId: string) => {
    setCramAreaId(null);
    onSelectArea(areaId);
    onHideAnswer();
    setChoosingArea(false);
  };
  const deferred =
    (queue?.deferredReviewCount ?? 0) +
    (queue?.deferredNewCount ?? 0) +
    (queue?.buriedCount ?? 0) +
    (queue?.filteredCount ?? 0);
  const emptyStateTitle =
    deferred > 0
      ? "Scheduled session complete"
      : !activeArea
        ? "Create your first subject"
        : activeArea.cards.length === 0
          ? "Build your subject"
          : session && session.reviewed > 0
            ? `You’re caught up in ${activeArea.title}`
            : "Already caught up";
  const emptyStateDescription =
    deferred > 0
      ? `${String(queue?.deferredReviewCount ?? 0)} returning cards deferred; ${String(queue?.deferredNewCount ?? 0)} new cards deferred by your daily settings; ${String(queue?.filteredCount ?? 0)} cards excluded by the study filter; ${String(queue?.buriedCount ?? 0)} cards buried until the next study day.`
      : !activeArea || activeArea.cards.length === 0
        ? "Add cards in Overview to start studying."
        : session && session.reviewed > 0
          ? `${String(session.reviewed)} ${session.reviewed === 1 ? "review" : "reviews"} this session · ${String(session.recalled)} recalled.`
          : "No cards due right now.";
  const deckChoiceRows = summarizeStudySubjects(workspace, now).map(({ area, due }) => (
    <DeckChoiceButton
      key={area.id}
      area={area}
      selected={area.id === activeArea?.id}
      dueCount={due}
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
            <NativeCollapsibleTrigger
              open={choosingArea}
              title={activeArea?.title ?? "Choose deck"}
              onToggle={() => {
                setChoosingArea((value) => !value);
              }}
              disabled={reviewPending}
            />
            <NativeCollapsibleContent open={choosingArea}>
              {deckChoiceRows}
            </NativeCollapsibleContent>
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

        {activeArea && (
          <NativeAdditionalStudyTools
            onSuspend={onSuspend}
            onPractice={() => {
              setCramAreaId(activeArea.id);
              onHideAnswer();
            }}
            card={card}
            onInteractionChange={setToolsOpen}
            workspaceStore={workspaceStore}
            onPurged={onPurged}
            protectedReferences={protectedReferences}
            mediaStore={mediaStore ?? undefined}
            workspace={workspace}
            area={activeArea}
            now={now}
            save={onStudyCommand}
            disabled={reviewPending}
          />
        )}
        {activeArea && cramAreaId === activeArea.id ? (
          <NativeCramPractice
            key={activeArea.id}
            area={activeArea}
            workspace={workspace}
            mediaStore={mediaStore}
            mediaRevision={mediaRevision}
            save={onStudyCommand}
            onExit={() => {
              setCramAreaId(null);
            }}
          />
        ) : card ? (
          <View className={"mt-[16px]"}>
            {workspace.areas.length <= 1 && (
              <Text className={"text-recall-ink text-[17px] font-bold tracking-[-0.3px]"}>
                {activeArea?.title ?? "Study"}
              </Text>
            )}
            {Boolean(queue?.learningAheadCount) && (
              <Text accessibilityLiveRegion="polite">
                Learning ahead: no other cards are due. This answer updates the normal schedule.
              </Text>
            )}
            <NativeReviewActivityCard
              {...(reviewActivities ? { activities: reviewActivities } : {})}
              card={card}
              reviewerSettings={workspace.schedulerSettings?.reviewer}
              automationPaused={toolsOpen || choosingArea || repairOpen}
              flagged={flaggedCardIds.includes(card.id)}
              {...(onFlag ? { onFlag } : {})}
              showAnswer={showAnswer}
              reviewPending={reviewPending}
              interactionPaused={repairOpen}
              mediaUris={mediaUris}
              reviewDelays={reviewDelays}
              ratingColors={nativeReviewRatingColors}
              onReview={onReview}
              onShowAnswer={onShowAnswer}
            />
            {activeArea && (
              <NativeReviewCardHelp
                key={card.id}
                workspace={workspace}
                area={activeArea}
                card={card}
                api={reviewRepairApi ?? null}
                save={onStudyCommand}
                disabled={reviewPending}
                onInteractionChange={setRepairOpen}
              />
            )}
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
            variant="default"
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
