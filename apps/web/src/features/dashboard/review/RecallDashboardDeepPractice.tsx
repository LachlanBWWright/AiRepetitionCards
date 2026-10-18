import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { BookOpen, Plus } from "lucide-react";
import { dueNow } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";

function reviewCountLabel(due: number): string {
  return due > 0
    ? `${String(due)} ${due === 1 ? "card" : "cards"} to review`
    : "Nothing due right now";
}

function createPracticeStarter(startPractice: (areaId: string) => void, areaId: string) {
  return () => {
    startPractice(areaId);
  };
}

function PracticeAreaCard({
  area,
  due,
  onStart,
}: {
  readonly area: RecallDashboardModel["workspace"]["areas"][number];
  readonly due: number;
  readonly onStart: () => void;
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: area.color }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2 className="m-0 truncate text-lg font-semibold">{area.title}</h2>
          <p className="m-0 text-sm text-[var(--muted)]">
            {reviewCountLabel(due)} · {area.cards.length} total
          </p>
        </div>
      </div>
      <Button variant={due > 0 ? "default" : "secondary"} disabled={due === 0} onClick={onStart}>
        {due > 0 ? "Start review" : "All caught up"}
      </Button>
    </section>
  );
}

function RecommendedActivityCard({
  recommendation,
  disabled,
  onStart,
}: {
  readonly recommendation: RecallDashboardModel["deepPracticeRecommendations"][number];
  readonly disabled: boolean;
  readonly onStart: () => void;
}) {
  return (
    <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <div>
        <h3 className="font-semibold">{recommendation.activity.title}</h3>
        <p className="text-sm text-muted-foreground">
          About {recommendation.estimatedMinutes} minutes · {recommendation.reason}
        </p>
      </div>
      <Button variant="secondary" disabled={disabled} onClick={onStart}>
        Start activity
      </Button>
    </article>
  );
}

export function RecallDashboardDeepPractice({ model }: { readonly model: RecallDashboardModel }) {
  const {
    dueCount,
    workspace,
    studiedToday,
    addArea,
    now,
    startPractice,
    deepPracticeRecommendations,
    libraryNotes,
    reviewSaving,
    openLearningActivity,
  } = model;
  return (
    <main className="mx-auto min-h-[80vh] w-full max-w-[1080px] space-y-8 px-4 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
          <p className="m-0 text-sm text-[var(--muted)]">
            {dueCount} cards to review across {workspace.areas.length} decks · {studiedToday}{" "}
            reviewed today
          </p>
        </div>
        <Button className="self-start sm:shrink-0" onClick={addArea}>
          <Plus aria-hidden="true" />
          New deck
        </Button>
      </div>
      {workspace.areas.length === 0 ? (
        <section
          className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-6 py-10 sm:py-12"
          aria-label="Get started"
        >
          <BookOpen className="mx-auto mb-4 size-8 text-[var(--muted)]" aria-hidden="true" />
          <EmptyState
            className="mx-auto max-w-sm"
            title="Build your first deck"
            description="Create a deck and add cards to start your daily review."
          />
        </section>
      ) : (
        <div className="grid gap-3">
          {workspace.areas.map((item) => {
            const due = item.cards.filter((entry) => dueNow(entry, now)).length;
            return (
              <PracticeAreaCard
                key={item.id}
                area={item}
                due={due}
                onStart={createPracticeStarter(startPractice, item.id)}
              />
            );
          })}
        </div>
      )}
      {deepPracticeRecommendations.length > 0 && (
        <section aria-label="Deeper practice" className="grid gap-3">
          <h2 className="text-xl font-semibold">Deeper practice</h2>
          <p className="text-sm text-muted-foreground">
            Longer activities build evidence beyond quick recall reviews.
          </p>
          {deepPracticeRecommendations.map((recommendation) => (
            <RecommendedActivityCard
              key={recommendation.activity.id}
              recommendation={recommendation}
              disabled={!libraryNotes.loaded || reviewSaving}
              onStart={() => {
                openLearningActivity(recommendation.activity.areaId, recommendation.activity.id);
              }}
            />
          ))}
        </section>
      )}
    </main>
  );
}
