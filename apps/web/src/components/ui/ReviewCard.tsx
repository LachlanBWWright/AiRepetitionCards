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
}: ReviewCardProps) {
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
            <button type="button" onClick={() => onEdit(card)}>
              Edit card
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={() => onDelete(card)}>
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
              <span>How well did you recall it?</span>
              <div className="rating-buttons">
                {ratings.map(({ rating, label }) => (
                  <button
                    className={`rating-${rating}`}
                    key={rating}
                    onClick={() => onRate(rating)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Button size="small" className="reveal-button" onClick={onReveal}>
              Show answer <span>↵</span>
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
