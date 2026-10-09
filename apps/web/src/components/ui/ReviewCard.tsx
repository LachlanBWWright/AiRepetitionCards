import { useEffect } from "react";
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
      <div className="flex min-h-8 items-center justify-end">
        {!card && <span className="text-[8px] font-semibold text-[var(--ink)]">COMPLETE</span>}
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
              <span className="text-[9px] text-[var(--muted)]" role={saving ? "status" : undefined}>
                {saving ? "Saving review…" : "How well did you recall it?"}
              </span>
              <div className="flex gap-1.5 max-[640px]:w-full max-[640px]:[&>button]:min-w-0 max-[640px]:[&>button]:flex-1">
                {ratings.map(({ rating, label }, index) => (
                  <Button
                    variant={rating === "again" ? "danger" : "secondary"}
                    className={`min-w-[54px] rounded-md border border-[var(--line)] bg-[var(--surface)] px-[9px] py-[7px] text-[9px] ${rating === "again" || rating === "hard" ? "text-[var(--status-warning-fg)]" : "text-[var(--status-success-fg)]"}`}
                    key={rating}
                    disabled={disabled || saving}
                    onClick={() => onRate(rating)}
                    aria-keyshortcuts={keyboardActive ? String(index + 1) : undefined}
                  >
                    {label}
                    {keyboardActive ? ` · ${String(index + 1)}` : ""}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <Button
              size="small"
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
          className="flex flex-1 flex-col items-center justify-center text-center [&>span]:text-[22px] [&>span]:text-[var(--status-success-fg)] [&_h3]:my-[9px] [&_h3]:mb-1 [&_h3]:text-[20px] [&_h3]:font-normal [&_h3]:[font-family:Georgia,serif] [&_p]:m-0 [&_p]:text-[10px] [&_p]:text-[var(--ink)] [&_button]:mt-[13px] [&_button]:rounded-md [&_button]:bg-[var(--primary)] [&_button]:px-[10px] [&_button]:py-[7px] [&_button]:text-[9px] [&_button]:text-white]"
          icon="✳"
          title={area ? "No cards due" : "Your library is empty"}
          description={area ? "Add a card or choose another area." : "Create an area to add cards."}
          action={<Button onClick={onAddCard}>{area ? "Add a card" : "New area"}</Button>}
        />
      )}
    </article>
  );
}
