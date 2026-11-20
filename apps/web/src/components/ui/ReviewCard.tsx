import { cardFieldAppearance } from "@recall/application";
import type { ReviewCardProps } from "./ReviewCardProps";
import { CardExplanation } from "../cards/explanations/CardExplanation";
import { occlusionAnswerLabel } from "@recall/application";
import { ImageOcclusionView } from "@/components/occlusion/ImageOcclusionView";
import { ReviewSpeech } from "../cards/ReviewSpeech";
import { CardRichText } from "@/components/cards/CardRichText";
import { TypedReviewAnswer } from "../cards/TypedReviewAnswer";
import { useReviewerInteraction } from "../cards/useReviewerInteraction";
import { ReviewerTimer } from "../cards/ReviewerTimer";
import { defaultReviewerSettings, type ReviewerSettings } from "@recall/domain";
import { Effect, Either } from "effect";
import { previewReviewSchedules } from "@recall/scheduler";
import { formatReviewDelay } from "@recall/application";
import type { Assessment } from "@recall/domain";
import { Button } from "@recall/ui-web/components/button";
import { EmptyState } from "./EmptyState";
import { InlineImage } from "./InlineImage";
import { ReviewCardActions } from "./ReviewCardActions";
import { ReviewQuestionContext } from "../cards/ReviewQuestionContext";

export type ReviewRating = "again" | "hard" | "good" | "easy";

const ratings: ReadonlyArray<{ rating: ReviewRating; label: string }> = [
  { rating: "again", label: "Again" },
  { rating: "hard", label: "Hard" },
  { rating: "good", label: "Good" },
  { rating: "easy", label: "Easy" },
];

export function ReviewCard({
  helpAction,
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
  reviewerSettings = defaultReviewerSettings,
}: ReviewCardProps) {
  const preview =
    card && now
      ? Effect.runSync(
          Effect.either(previewReviewSchedules(card.schedule, now, schedulerParameters)),
        )
      : null;
  const emptyDeck = session?.cardCount === 0;
  const deferred =
    (session?.deferredReviewCount ?? 0) +
    (session?.deferredNewCount ?? 0) +
    (session?.buriedCount ?? 0) +
    (session?.filteredCount ?? 0);
  const emptyTitle =
    deferred > 0
      ? "Scheduled session complete"
      : !area
        ? "Your library is empty"
        : emptyDeck
          ? "Build your deck"
          : session && session.reviewed > 0
            ? `You’re caught up in ${area.title}`
            : "Already caught up";
  const flaggedAction =
    flaggedCount > 0 && onEditFlagged ? (
      <Button variant="default" onClick={onEditFlagged}>
        Edit flagged cards ({flaggedCount})
      </Button>
    ) : null;
  const navigationAction =
    area && !emptyDeck ? (
      onNextDeck ? (
        <Button onClick={onNextDeck}>Review next deck</Button>
      ) : onBack ? (
        <Button onClick={onBack}>Back to Today</Button>
      ) : null
    ) : null;
  const ratingDelays =
    preview && Either.isRight(preview) && now
      ? Object.fromEntries(
          ratings.map(({ rating }) => [
            rating,
            formatReviewDelay(preview.right[rating].due, now.getTime()),
          ]),
        )
      : {};
  const controls = useReviewerInteraction({
    cardId: card?.id,
    revealed: showAnswer,
    enabled: keyboardActive && !disabled && !saving,
    settings: reviewerSettings,
    onReveal,
    onRate,
  });
  const inlineMediaUrls = Object.fromEntries(
    mediaPreviews.flatMap((preview) =>
      preview.id && preview.id !== card?.imageOcclusion?.imageMediaId
        ? [[preview.id, preview.url]]
        : [],
    ),
  );
  const revealKeyShortcuts = keyboardActive
    ? `Enter ${shortcutLabel(reviewerSettings.shortcuts.reveal)}`
    : undefined;
  const revealHint = keyboardActive
    ? `${shortcutLabel(reviewerSettings.shortcuts.reveal)} / ↵`
    : "↵";
  return (
    <article className="flex min-w-0 min-h-[400px] flex-col overflow-hidden rounded-2xl border border-border bg-card px-5 pt-5 sm:px-8 sm:pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        {session && card && (
          <p className="text-sm leading-6 text-muted-foreground" role="status">
            <span className="font-medium text-foreground">{session.remaining} remaining</span>
            <span className="ml-3">{session.reviewed} reviewed this session</span>
            <br />
            {session.newCards} new · {session.learningCards} learning ·{" "}
            {session.remaining - session.newCards - session.learningCards} review
          </p>
        )}
        <ReviewCardActions
          card={card}
          helpAction={helpAction}
          flagged={flagged}
          onFlag={onFlag}
          onEdit={onEdit}
          onDelete={onDelete}
          disabled={disabled || saving}
        />
        {!card && session && session.reviewed > 0 && (
          <span className="text-sm text-muted-foreground">Session finished</span>
        )}
      </div>
      {card ? (
        <>
          <ReviewerTimer
            showTimer={reviewerSettings.showTimer}
            {...controls}
            disabled={disabled || saving || !keyboardActive}
          />
          <div
            {...controls.gestureHandlers}
            className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center py-10 sm:py-12"
          >
            {showAnswer && <ReviewQuestionContext card={card} mediaUrls={inlineMediaUrls} />}
            <span className="mb-4 text-sm font-medium text-muted-foreground">
              {showAnswer ? "Answer" : "Question"}
            </span>
            <CardRichText
              appearance={cardFieldAppearance(card.presentation, showAnswer ? "back" : "front")}
              text={showAnswer ? occlusionAnswerLabel(card.imageOcclusion, card.back) : card.front}
              mediaUrls={inlineMediaUrls}
              className="w-full whitespace-pre-wrap text-left font-sans text-xl leading-relaxed [overflow-wrap:anywhere] sm:text-[22px]"
            />
          </div>
          {showAnswer && card.explanation && (
            <CardExplanation
              key={card.id}
              text={card.explanation}
              mediaUrls={inlineMediaUrls}
              appearance={cardFieldAppearance(card.presentation, "explanation")}
            />
          )}
          <ReviewSpeech card={card} revealed={showAnswer} />
          <TypedReviewAnswer
            key={card.id}
            card={card}
            revealed={showAnswer}
            disabled={disabled || saving}
            onReveal={onReveal}
          />
          {mediaPreviews.length > 0 && (
            <div
              className="mx-auto mb-5 flex max-w-[720px] flex-wrap justify-center gap-3"
              aria-label="Card media"
            >
              <ReviewMediaList card={card} previews={mediaPreviews} revealed={showAnswer} />
            </div>
          )}
          {showAnswer ? (
            <div className="-mx-5 mt-auto flex flex-col items-center gap-4 border-t border-border bg-muted/20 px-5 py-6 sm:-mx-8 sm:px-8">
              <span className="text-sm text-[var(--muted)]" role={saving ? "status" : undefined}>
                {saving ? "Saving review…" : "How well did you recall it?"}
              </span>
              <ReviewRatingButtons
                disabled={disabled || saving}
                keyboardActive={keyboardActive}
                delays={ratingDelays}
                shortcuts={reviewerSettings.shortcuts}
                onRate={onRate}
              />
              <p className="text-xs text-muted-foreground text-center">
                Again: forgot · Hard: difficult · Good: recalled · Easy: effortless
              </p>
            </div>
          ) : (
            <Button
              size="default"
              className="mb-6 self-center"
              onClick={onReveal}
              disabled={disabled || saving}
              aria-keyshortcuts={revealKeyShortcuts}
            >
              Show answer <span>{revealHint}</span>
            </Button>
          )}
        </>
      ) : (
        <EmptyState
          className="flex flex-1 flex-col items-center justify-center p-6 text-center [&_p]:text-sm [&_h3]:text-xl"
          icon="✳"
          title={emptyTitle}
          description={
            !area
              ? "Create a deck to add cards."
              : emptyDeck
                ? "Add your first card to start studying."
                : `${deferred > 0 ? `${String(session?.deferredReviewCount ?? 0)} returning cards deferred; ${String(session?.deferredNewCount ?? 0)} new cards deferred by your daily settings; ${String(session?.filteredCount ?? 0)} cards excluded by the study filter; ${String(session?.buriedCount ?? 0)} cards buried until the next study day. ` : ""}${session?.reviewed ? `${String(session.reviewed)} ${session.reviewed === 1 ? "review" : "reviews"} this session · ${String(session.recalled)} recalled. ` : "No cards due right now. "}${session?.nextReviewAt ? `Next review: ${new Date(session.nextReviewAt).toLocaleString()}.` : ""}`
          }
          action={
            <div className="flex flex-wrap justify-center gap-2 pb-5">
              {flaggedAction}
              {navigationAction}
              <Button variant="default" onClick={onAddCard}>
                {area ? (emptyDeck ? "Add your first card" : "Add more cards") : "New deck"}
              </Button>
            </div>
          }
        />
      )}
    </article>
  );
}

function ReviewRatingButtons({
  disabled,
  keyboardActive,
  delays,
  shortcuts,
  onRate,
}: {
  readonly disabled: boolean;
  readonly keyboardActive: boolean;
  readonly delays: Partial<Record<ReviewRating, string>>;
  readonly shortcuts: ReviewerSettings["shortcuts"];
  readonly onRate: (rating: ReviewRating) => void;
}) {
  return (
    <div className="grid w-full max-w-xl grid-cols-4 gap-2 sm:gap-3">
      {ratings.map(({ rating, label }) => (
        <Button
          size="rating"
          className="min-w-0"
          variant="secondary"
          key={rating}
          disabled={disabled}
          onClick={() => {
            onRate(rating);
          }}
          aria-keyshortcuts={keyboardActive ? shortcutLabel(shortcuts[rating]) : undefined}
        >
          <span className="flex items-center gap-2">
            {label}
            {keyboardActive && (
              <kbd className="hidden text-xs font-normal sm:inline">
                {shortcutLabel(shortcuts[rating])}
              </kbd>
            )}
          </span>
          {delays[rating] && <span className="text-xs font-normal">{delays[rating]}</span>}
        </Button>
      ))}
    </div>
  );
}

function renderReviewMediaPreview(preview: { readonly mimeType: string; readonly url: string }) {
  return preview.mimeType.startsWith("image/") ? (
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
  );
}

function ReviewMediaList({
  card,
  previews,
  revealed,
}: {
  readonly card: Assessment;
  readonly previews: readonly {
    readonly id?: string;
    readonly mimeType: string;
    readonly url: string;
  }[];
  readonly revealed: boolean;
}) {
  return previews.map((preview) =>
    card.imageOcclusion && preview.id === card.imageOcclusion.imageMediaId ? (
      <ImageOcclusionView
        key={preview.url}
        image={card.imageOcclusion}
        url={preview.url}
        revealed={revealed}
      />
    ) : (
      renderReviewMediaPreview(preview)
    ),
  );
}

function shortcutLabel(key: string) {
  return key === " " ? "Space" : key;
}
