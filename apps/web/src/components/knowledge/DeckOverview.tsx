import type { LearningArea } from "@recall/domain";
import { Button } from "@recall/ui-web/components/button";
import { summarizeStudySession } from "@recall/application";

export function DeckOverview({
  areas,
  selectedId,
  now,
  onOpen,
  onStudy,
  disabled = false,
}: {
  readonly areas: readonly LearningArea[];
  readonly selectedId: string;
  readonly now: number;
  readonly onOpen: (id: string) => void;
  readonly onStudy: (id: string) => void;
  readonly disabled?: boolean;
}) {
  return (
    <section aria-label="Deck overview" className="grid gap-3">
      <h2 className="text-lg font-semibold">Your decks</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {areas.map((area) => {
          const summary = summarizeStudySession(area, [], now);
          return (
            <article
              key={area.id}
              className="grid gap-3 rounded-xl border bg-card p-4"
              aria-label={area.title}
            >
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ backgroundColor: area.color }} />
                <h3 className="font-semibold">{area.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                {area.cards.length} {area.cards.length === 1 ? "card" : "cards"} ·{" "}
                {summary.remaining} due
                <br />
                {summary.remaining > 0
                  ? "Ready to review"
                  : summary.nextReviewAt
                    ? `Next review: ${new Date(summary.nextReviewAt).toLocaleString()}`
                    : "Add cards to get started"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onOpen(area.id)}
                  aria-pressed={selectedId === area.id}
                >
                  Open deck
                </Button>
                <Button
                  disabled={disabled || summary.remaining === 0}
                  onClick={() => onStudy(area.id)}
                >
                  Review {summary.remaining} due
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
