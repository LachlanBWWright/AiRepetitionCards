import { Button } from "@recall/ui-web";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import { localSnapshotStale } from "@/features/workspace/local-snapshot-status";
import { ReviewLearningActivities } from "./activities/ReviewLearningActivities";
import { mergeActivityLibraries } from "@recall/application";
import { emptyActivityLibrary } from "@recall/domain";
import { Effect, Either } from "effect";
import { useState } from "react";
import { ReviewCardHelp } from "./assistance/ReviewCardHelp";
import { applyMediaTrashPurge } from "@recall/application";
import { browserWorkspaceStore } from "@/features/workspace/browser-workspace-store";
import { libraryDraftMediaReferences } from "@recall/application";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { summarizeStudySession, toggleCardFlag } from "@recall/application";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { ReviewCard } from "@/components/ui/ReviewCard";
import { reviewParameters, nextStudyArea } from "@recall/application";
import { StudyTools } from "./StudyTools";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";

function createNextDeckHandler(startPractice: (areaId: string) => void, areaId: string) {
  return function startNextDeck() {
    startPractice(areaId);
  };
}

export function RecallDashboardStudyCard({ model }: { readonly model: RecallDashboardModel }) {
  const [activityState, setActivityState] = useState<{
    readonly cardId: string;
    readonly open: boolean;
    readonly accepted: boolean;
  } | null>(null);
  const activityOpen = activityState?.cardId === model.card?.id && activityState?.open === true;
  const activityAccepted =
    activityState?.cardId === model.card?.id && activityState?.accepted === true;
  const [repairOpen, setRepairOpen] = useState(false);
  const [studyToolsBusy, setStudyToolsBusy] = useState(false);
  const {
    queue,
    saveAuthoringCommand,
    reviewSaving,
    reviewSaveFailed,
    area,
    setActiveView,
    now,
    workspace,
    setShowAnswer,
    startPractice,
    libraryNotes,
    card,
    setOnlyFlagged,
    onViewChange,
    sessionEvents,
    mediaPreviews,
    showAnswer,
    addingArea,
    addingCard,
    showAreaSettings,
    erased,
    stale,
    demo,
    ready,
    cacheMayWrite,
    review,
    editCard,
    deleteCard,
    addCard,
  } = model;
  function startNextPractice(areaId: string) {
    startPractice(areaId);
  }
  const assistanceDisabled =
    reviewSaving || reviewSaveFailed || erased || stale || (!demo && (!ready || !cacheMayWrite));
  const flaggedCount =
    area?.cards.filter((entry) => libraryNotes.notes.flaggedCardIds.includes(entry.id)).length ?? 0;
  const nextArea = area ? nextStudyArea(workspace, now.getTime(), area.id) : undefined;
  const onNextDeck = nextArea ? createNextDeckHandler(startNextPractice, nextArea.id) : undefined;
  function setActivityOpen(open: boolean) {
    if (!card) return;
    setActivityState((current) => ({
      cardId: card.id,
      open,
      accepted: current?.cardId === card.id && current.accepted,
    }));
  }
  function acceptActivity() {
    if (card)
      setActivityState((current) => ({
        cardId: card.id,
        open: current?.cardId === card.id && current.open,
        accepted: true,
      }));
  }
  function revealAfterActivity() {
    setShowAnswer(true);
  }
  async function saveReviewActivityLibrary(incoming: import("@recall/domain").ActivityLibrary) {
    if (localWritesBlocked() || localSnapshotStale() || assistanceDisabled || !libraryNotes.loaded)
      return false;
    const validation = { valid: true };
    libraryNotes.update((notes) => {
      const merged = Effect.runSync(
        Effect.either(
          mergeActivityLibraries(incoming, notes.activityLibrary ?? emptyActivityLibrary),
        ),
      );
      if (Either.isLeft(merged)) {
        validation.valid = false;
        return notes;
      }
      return { ...notes, activityLibrary: merged.right };
    });
    return validation.valid ? libraryNotes.flush() : false;
  }
  const helpAction =
    card && area ? (
      <ReviewCardHelp
        key={card.id}
        workspace={workspace}
        area={area}
        card={card}
        save={saveAuthoringCommand}
        disabled={assistanceDisabled || activityOpen}
        onInteractionChange={setRepairOpen}
      />
    ) : null;
  return (
    <div
      className="mx-auto w-full max-w-[1080px] px-4 py-5 sm:px-8 lg:px-11"
      inert={reviewSaving || reviewSaveFailed}
    >
      <div className="flex flex-col gap-4">
        {!area ? (
          <p className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
            This deck is no longer available.{" "}
            <Button
              variant="default"
              type="button"
              className="underline"
              onClick={() => {
                setActiveView(DashboardView.Today);
              }}
            >
              Return to Home
            </Button>
          </p>
        ) : (
          <>
            <StudyTools
              onBusyChange={setStudyToolsBusy}
              workspaceStore={browserWorkspaceStore}
              onPurged={(result) => {
                model.setWorkspace((current) => applyMediaTrashPurge(current, result));
              }}
              protectedReferences={libraryDraftMediaReferences(libraryNotes.notes)}
              workspace={workspace}
              mediaStore={browserMediaStore}
              area={area}
              card={card}
              save={saveAuthoringCommand}
              onEdit={editCard}
              disabled={
                activityOpen ||
                repairOpen ||
                reviewSaving ||
                reviewSaveFailed ||
                erased ||
                stale ||
                (!demo && (!ready || !cacheMayWrite))
              }
            />
            {Boolean(queue?.learningAheadCount) && (
              <p role="status" className="text-sm text-muted-foreground">
                Learning ahead: no other cards are due. This answer updates the normal schedule.
              </p>
            )}
            <ReviewCard
              helpAction={helpAction}
              reviewerSettings={workspace.schedulerSettings?.reviewer}
              area={area}
              flaggedCount={flaggedCount}
              flagged={Boolean(card && libraryNotes.notes.flaggedCardIds.includes(card.id))}
              onFlag={(target) => {
                libraryNotes.update((notes) => toggleCardFlag(notes, target.id));
              }}
              onEditFlagged={() => {
                setOnlyFlagged(true);
                if (onViewChange) onViewChange(DashboardView.Library, area.id, "flagged");
                else setActiveView(DashboardView.Library, area.id);
              }}
              session={summarizeStudySession(area, sessionEvents, now.getTime(), queue)}
              now={now}
              schedulerParameters={card ? reviewParameters(workspace, area.id, card.id) : undefined}
              onBack={() => {
                setActiveView(DashboardView.Today);
              }}
              onNextDeck={onNextDeck}
              card={card}
              mediaPreviews={mediaPreviews}
              showAnswer={showAnswer}
              keyboardActive={
                !activityOpen &&
                !activityAccepted &&
                !repairOpen &&
                !studyToolsBusy &&
                !addingArea &&
                !addingCard &&
                !showAreaSettings &&
                !reviewSaving &&
                !reviewSaveFailed &&
                !erased &&
                !stale
              }
              disabled={
                studyToolsBusy ||
                activityOpen ||
                repairOpen ||
                reviewSaving ||
                reviewSaveFailed ||
                erased ||
                stale ||
                (!demo && (!ready || !cacheMayWrite))
              }
              saving={reviewSaving}
              onReveal={() => {
                setShowAnswer(true);
              }}
              onRate={(rating) => void review(rating)}
              onEdit={editCard}
              onDelete={(target) => void deleteCard(target)}
              onAddCard={addCard}
            />
            {card && (
              <ReviewLearningActivities
                key={card.id}
                card={card}
                areaId={area.id}
                objectives={area.objectives ?? []}
                library={libraryNotes.notes.activityLibrary ?? emptyActivityLibrary}
                {...(model.activityServices ? { services: model.activityServices } : {})}
                disabled={assistanceDisabled || !libraryNotes.loaded || repairOpen}
                createId={() => crypto.randomUUID()}
                onOpenChange={setActivityOpen}
                onAccepted={acceptActivity}
                onReturn={revealAfterActivity}
                onSave={saveReviewActivityLibrary}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
