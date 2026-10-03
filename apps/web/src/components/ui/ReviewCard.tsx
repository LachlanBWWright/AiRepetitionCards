import { useEffect } from "react";
import type { LearningArea, StudyCard } from "@recall/domain";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import Image from "next/image";

export type ReviewRating = "again" | "hard" | "good" | "easy";

type ReviewCardProps = {
  area: Pick<LearningArea, "title" | "color"> | undefined;
  card: StudyCard | undefined;
  showAnswer: boolean;
  onReveal: () => void;
  onRate: (rating: ReviewRating) => void;
  onEdit?: (card: StudyCard) => void;
  onDelete?: (card: StudyCard) => void;
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
    <article className="study-card">
      <div className="study-card-head">
        <span className="study-area-label">
          <i style={{ backgroundColor: area?.color }} />
          {area?.title ?? "Choose a learning area"}
        </span>
        <span className="card-position">{card ? "UP NEXT" : "COMPLETE"}</span>
      </div>
      {card && (onEdit || onDelete) && (
        <div className="study-card-actions">
          {onEdit && (
            <button type="button" disabled={disabled || saving} onClick={() => onEdit(card)}>
              Edit card
            </button>
          )}
          {onDelete && (
            <button type="button" disabled={disabled || saving} onClick={() => onDelete(card)}>
              Delete
            </button>
          )}
        </div>
      )}
      {card ? (
        <>
          <div className="flashcard-content">
            <span className="card-hint">{showAnswer ? "ANSWER" : "QUESTION"}</span>
            <p>{showAnswer ? card.back : card.front}</p>
          </div>
          {mediaPreviews.length > 0 && (
            <div className="review-media" aria-label="Card media">
              {mediaPreviews.map((preview) =>
                preview.mimeType.startsWith("image/") ? (
                  <Image
                    key={preview.url}
                    src={preview.url}
                    alt="Study card attachment"
                    width={640}
                    height={400}
                    unoptimized
                  />
                ) : (
                  <audio
                    key={preview.url}
                    controls
                    src={preview.url}
                    aria-label="Study card audio"
                  />
                ),
              )}
            </div>
          )}
          {showAnswer ? (
            <div className="rating-row">
              <span role={saving ? "status" : undefined}>
                {saving ? "Saving review…" : "How well did you recall it?"}
              </span>
              <div className="rating-buttons">
                {ratings.map(({ rating, label }, index) => (
                  <button
                    className={`rating-${rating}`}
                    key={rating}
                    disabled={disabled || saving}
                    onClick={() => onRate(rating)}
                    aria-keyshortcuts={keyboardActive ? String(index + 1) : undefined}
                  >
                    {label}
                    {keyboardActive ? ` · ${String(index + 1)}` : ""}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Button
              size="small"
              className="reveal-button"
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
          className="empty-study"
          icon="✳"
          title="You’re all caught up."
          description="Add a card or come back when it’s time to review."
          action={<button onClick={onAddCard}>Add a card</button>}
        />
      )}
      <div className="study-card-foot">
        <span>◉ Scheduled with FSRS</span>
        <span>Private to you</span>
      </div>
    </article>
  );
}
