import { useEffect } from "react";
import { Effect, Either } from "effect";
import { previewReviewSchedules, type SchedulerParameters } from "@recall/scheduler";
import { summarizeStudySession, formatReviewDelay } from "@recall/application";
import type { LearningArea, Assessment } from "@recall/domain";
import { Button } from "@recall/ui-web/components/button";
import { EmptyState } from "./EmptyState";
import { InlineImage } from "./InlineImage";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

export type ReviewRating = "again" | "hard" | "good" | "easy";

type ReviewCardProps = {
  area: Pick<LearningArea, "title" | "color"> | undefined;
  readonly session?: ReturnType<typeof summarizeStudySession>;
  readonly now?: Date;
  readonly schedulerParameters?: SchedulerParameters | undefined;
  readonly onBack?: () => void;
  readonly onNextDeck?: (() => void) | undefined;
  readonly flagged?: boolean;
  readonly flaggedCount?: number;
  readonly onFlag?: (card: Assessment) => void;
  readonly onEditFlagged?: () => void;
  card: Assessment | undefined;
  showAnswer: boolean;
  onReveal: () => void;
  onRate: (rating: ReviewRating) => void;
  onEdit?: (card: Assessment) => void;
  onDelete?: (card: Assessment) => void;
  onAddCard: () => void;
  mediaPreviews?: readonly { readonly mimeType: string; readonly url: string }[];
  keyboardActive?: boolean;
  disabled?: boolean;
  saving?: boolean;
};

const ratings: ReadonlyArray<{ rating: ReviewRating; label: string }> = [
  { rating: "again", label: "Again" },
  { rating: "hard", label: "Hard" },
  { rating: "good", label: "Good" },
  { rating: "easy", label: "Easy" },
];

export function ReviewCard({
  area,
  session,
  now,
  schedulerParameters,
  onBack,
  onNextDeck,
  flagged = false,
  flaggedCount = 0,
  onFlag,
  onEditFlagged,
  card,
  showAnswer,
  onReveal,
  onRate,
  onEdit,
  onDelete,
  onAddCard,
  mediaPreviews = [],
  keyboardActive = false,
  disabled = false,
  saving = false,
}: ReviewCardProps) {
  const preview =
    card && now
      ? Effect.runSync(
          Effect.either(previewReviewSchedules(card.schedule, now, schedulerParameters)),
        )
      : null;
  const emptyDeck = session?.cardCount === 0;
  useEffect(() => {
    if (!keyboardActive || !card || disabled || saving) return;
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input, textarea, select, button, a, audio, video, summary, [contenteditable], [role=dialog], [role=button], [role=slider], [role=spinbutton], [role=combobox], [role=textbox]",
        )
      )
        return;
      if (!showAnswer && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        onReveal();
      } else if (showAnswer) {
        const rating = ratings[Number(event.key) - 1];
        if (/^[1-4]$/.test(event.key) && rating) {
          event.preventDefault();
          onRate(rating.rating);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [keyboardActive, card, showAnswer, onReveal, onRate, disabled, saving]);
  return (
    <article className="flex min-h-[262px] flex-col rounded-[11px] border border-[var(--line)] bg-[var(--surface)] px-[17px] pt-[14px]">
      {session && card && (
        <p className="text-sm text-muted-foreground" role="status">
          {session.reviewed} reviewed this session · {session.remaining} remaining
          <br />
          {session.newCards} new · {session.learningCards} learning ·{" "}
          {session.remaining - session.newCards - session.learningCards} review
        </p>
      )}
      <div className="flex min-h-8 items-center justify-end">
        {card && onFlag && (
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || saving}
            aria-pressed={flagged}
            onClick={() => onFlag(card)}
          >
            {flagged ? "Flagged for editing" : "Improve later"}
          </Button>
        )}
        {!card && session && session.reviewed > 0 && (
          <span className="text-xs font-semibold text-[var(--ink)]">SESSION FINISHED</span>
        )}
        {card && (onEdit || onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-8 rounded-md border-transparent bg-transparent text-[var(--muted)] shadow-none hover:bg-[var(--surface-raised)] hover:text-[var(--ink)]"
                disabled={disabled || saving}
                aria-label="Card actions"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (
                <DropdownMenuItem onSelect={() => onEdit(card)}>Edit card</DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(card)}>
                  Delete card
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {card ? (
        <>
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-4 text-center">
            <span className="text-[8px] font-bold tracking-[1.1px] text-[var(--ink)]">
              {showAnswer ? "ANSWER" : "QUESTION"}
            </span>
            <p className="mt-[13px] max-w-[435px] whitespace-pre-wrap text-[22px] leading-[1.4] tracking-[-0.35px] [overflow-wrap:anywhere] [font-family:Georgia,serif]">
              {showAnswer ? card.back : card.front}
            </p>
          </div>
          {mediaPreviews.length > 0 && (
            <div
              className="mx-auto mb-5 flex max-w-[720px] flex-wrap justify-center gap-3"
              aria-label="Card media"
            >
              {mediaPreviews.map((preview) =>
                preview.mimeType.startsWith("image/") ? (
                  <InlineImage
                    key={preview.url}
                    src={preview.url}
                    alt="Study card attachment"
                    width={640}
                    height={400}
                    className="max-h-[300px] max-w-[min(100%,420px)] rounded-[10px] object-contain"
                  />
                ) : (
                  <audio
                    key={preview.url}
                    controls
                    src={preview.url}
                    aria-label="Study card audio"
                    className="w-[min(100%,420px)]"
                  />
                ),
              )}
            </div>
          )}
          {showAnswer ? (
            <div className="flex flex-col items-center gap-[9px] pb-[15px]">
              <span className="text-sm text-[var(--muted)]" role={saving ? "status" : undefined}>
                {saving ? "Saving review…" : "How well did you recall it?"}
              </span>
              <div className="flex gap-1.5 max-[640px]:w-full max-[640px]:[&>button]:min-w-0 max-[640px]:[&>button]:flex-1">
                {ratings.map(({ rating, label }, index) => (
                  <Button
                    variant={rating === "again" ? "destructive" : "secondary"}
                    className={`min-h-12 min-w-[72px] flex-col rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm ${rating === "again" || rating === "hard" ? "text-[var(--status-warning-fg)]" : "text-[var(--status-success-fg)]"}`}
                    key={rating}
                    disabled={disabled || saving}
                    onClick={() => onRate(rating)}
                    aria-keyshortcuts={keyboardActive ? String(index + 1) : undefined}
                  >
                    {label}
                    {keyboardActive ? ` · ${String(index + 1)}` : ""}
                    {preview && Either.isRight(preview) && now && (
                      <span className="text-xs font-normal">
                        {formatReviewDelay(preview.right[rating].due, now.getTime())}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Again: forgot · Hard: recalled with difficulty · Good: recalled · Easy: effortless
              </p>
            </div>
          ) : (
            <Button
              size="sm"
              className="mb-[17px] self-center rounded-[7px] bg-[var(--primary)] px-[13px] py-[9px] text-[10px] text-white hover:bg-[var(--status-success-bg)]"
              onClick={onReveal}
              disabled={disabled || saving}
              aria-keyshortcuts={keyboardActive ? "Enter Space" : undefined}
            >
              Show answer <span>{keyboardActive ? "Space / ↵" : "↵"}</span>
            </Button>
          )}
        </>
      ) : (
        <EmptyState
          className="flex flex-1 flex-col items-center justify-center p-6 text-center [&_p]:text-sm [&_h3]:text-xl"
          icon="✳"
          title={
            !area
              ? "Your library is empty"
              : emptyDeck
                ? "Build your deck"
                : session && session.reviewed > 0
                  ? `You’re caught up in ${area.title}`
                  : "Already caught up"
          }
          description={
            !area
              ? "Create a deck to add cards."
              : emptyDeck
                ? "Add your first card to start studying."
                : `${session?.reviewed ? `${session.reviewed} ${session.reviewed === 1 ? "review" : "reviews"} this session · ${session.recalled} recalled. ` : "No cards due right now. "}${session?.nextReviewAt ? `Next review: ${new Date(session.nextReviewAt).toLocaleString()}.` : ""}`
          }
          action={
            <div className="flex flex-wrap justify-center gap-2 pb-5">
              {flaggedCount > 0 && onEditFlagged && (
                <Button variant="secondary" onClick={onEditFlagged}>
                  Edit flagged cards ({flaggedCount})
                </Button>
              )}
              {area &&
                !emptyDeck &&
                (onNextDeck ? (
                  <Button onClick={onNextDeck}>Review next deck</Button>
                ) : onBack ? (
                  <Button onClick={onBack}>Back to Today</Button>
                ) : null)}
              <Button variant={area && !emptyDeck ? "secondary" : "default"} onClick={onAddCard}>
                {area ? (emptyDeck ? "Add your first card" : "Add more cards") : "New deck"}
              </Button>
            </div>
          }
        />
      )}
    </article>
  );
}
