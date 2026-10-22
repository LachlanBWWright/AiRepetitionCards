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
  const flaggedCount =
    area?.cards.filter((entry) => libraryNotes.notes.flaggedCardIds.includes(entry.id)).length ?? 0;
  const nextArea = area ? nextStudyArea(workspace, now.getTime(), area.id) : undefined;
  const onNextDeck = nextArea ? createNextDeckHandler(startNextPractice, nextArea.id) : undefined;
  return (
    <div
      className="mx-auto w-full max-w-[1080px] px-4 py-10 sm:px-8 lg:px-11"
      inert={reviewSaving || reviewSaveFailed}
    >
      <div className="mt-7 block">
        {!area ? (
          <p className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
            This deck is no longer available.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                setActiveView(DashboardView.Today);
              }}
            >
              Return to Home
            </button>
          </p>
        ) : (
          <>
            <StudyTools
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
                reviewSaving ||
                reviewSaveFailed ||
                erased ||
                stale ||
                (!demo && (!ready || !cacheMayWrite))
              }
            />
            <ReviewCard
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
                !addingArea &&
                !addingCard &&
                !showAreaSettings &&
                !reviewSaving &&
                !reviewSaveFailed &&
                !erased &&
                !stale
              }
              disabled={
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
          </>
        )}
      </div>
    </div>
  );
}
