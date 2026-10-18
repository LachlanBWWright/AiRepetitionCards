import { summarizeStudySession, toggleCardFlag } from "@recall/application";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { ReviewCard } from "@/components/ui/ReviewCard";
import { dueNow } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";

function findNextDueArea(
  areas: RecallDashboardModel["workspace"]["areas"],
  currentAreaId: string,
  now: Date,
) {
  return areas.find(
    (item) => item.id !== currentAreaId && item.cards.some((entry) => dueNow(entry, now)),
  );
}

function createNextDeckHandler(startPractice: (areaId: string) => void, areaId: string) {
  return function startNextDeck() {
    startPractice(areaId);
  };
}

export function RecallDashboardStudyCard({ model }: { readonly model: RecallDashboardModel }) {
  const {
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
  const nextArea = area ? findNextDueArea(workspace.areas, area.id, now) : undefined;
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
          <ReviewCard
            area={area}
            flaggedCount={
              area.cards.filter((entry) => libraryNotes.notes.flaggedCardIds.includes(entry.id))
                .length
            }
            flagged={Boolean(card && libraryNotes.notes.flaggedCardIds.includes(card.id))}
            onFlag={(target) => {
              libraryNotes.update((notes) => toggleCardFlag(notes, target.id));
            }}
            onEditFlagged={() => {
              setOnlyFlagged(true);
              if (onViewChange) onViewChange(DashboardView.Library, area.id, "flagged");
              else setActiveView(DashboardView.Library, area.id);
            }}
            session={summarizeStudySession(area, sessionEvents, now.getTime())}
            now={now}
            schedulerParameters={workspace.schedulerSettings}
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
        )}
      </div>
    </div>
  );
}
