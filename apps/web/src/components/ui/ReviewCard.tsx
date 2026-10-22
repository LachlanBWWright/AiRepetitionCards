import { occlusionAnswerLabel } from "@recall/application";
import { ImageOcclusionView } from "@/components/occlusion/ImageOcclusionView";
import { ReviewSpeech } from "../cards/ReviewSpeech";
import { CardRichText } from "@/components/cards/CardRichText";
import { TypedReviewAnswer } from "../cards/TypedReviewAnswer";
import { useReviewerInteraction } from "../cards/useReviewerInteraction";
import { ReviewerTimer } from "../cards/ReviewerTimer";
import { defaultReviewerSettings, type ReviewerSettings } from "@recall/domain";
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
  mediaPreviews?: readonly {
    readonly id?: string;
    readonly mimeType: string;
    readonly url: string;
  }[];
  keyboardActive?: boolean;
  disabled?: boolean;
  saving?: boolean;
  readonly reviewerSettings?: ReviewerSettings | undefined;
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
      <Button variant="secondary" onClick={onEditFlagged}>
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
  const deleteCardAction =
    onDelete && card ? (
      <DropdownMenuItem
        variant="destructive"
        onSelect={() => {
          onDelete(card);
        }}
      >
        Delete card
      </DropdownMenuItem>
    ) : null;
  const controls = useReviewerInteraction({
    cardId: card?.id,
    revealed: showAnswer,
    enabled: keyboardActive && !disabled && !saving,
    settings: reviewerSettings,
    onReveal,
    onRate,
  });
  const editCard = () => {
    if (card && onEdit) onEdit(card);
  };
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
            onClick={() => {
              onFlag(card);
            }}
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
              {onEdit && <DropdownMenuItem onSelect={editCard}>Edit card</DropdownMenuItem>}
              {deleteCardAction}
            </DropdownMenuContent>
          </DropdownMenu>
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
            className="flex flex-1 flex-col items-center justify-center px-6 py-4 text-center"
          >
            <span className="text-[8px] font-bold tracking-[1.1px] text-[var(--ink)]">
              {showAnswer ? "ANSWER" : "QUESTION"}
            </span>
            <CardRichText
              appearance={card.presentation?.appearance}
              text={showAnswer ? occlusionAnswerLabel(card.imageOcclusion, card.back) : card.front}
              mediaUrls={inlineMediaUrls}
              className="mt-[13px] max-w-[435px] whitespace-pre-wrap text-[22px] leading-[1.4] tracking-[-0.35px] [overflow-wrap:anywhere] [font-family:Georgia,serif]"
            />
          </div>
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
            <div className="flex flex-col items-center gap-[9px] pb-[15px]">
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
                Again: forgot · Hard: recalled with difficulty · Good: recalled · Easy: effortless
              </p>
            </div>
          ) : (
            <Button
              size="sm"
              className="mb-[17px] self-center rounded-[7px] bg-[var(--primary)] px-[13px] py-[9px] text-[10px] text-white hover:bg-[var(--status-success-bg)]"
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
                : `${deferred > 0 ? `${String(session?.deferredReviewCount ?? 0)} returning cards deferred; ${String(session?.deferredNewCount ?? 0)} new cards deferred by your daily settings; ${String(session?.filteredCount ?? 0)} cards excluded by the study filter; ${String(session?.buriedCount ?? 0)} related cards buried until tomorrow. ` : ""}${session?.reviewed ? `${String(session.reviewed)} ${session.reviewed === 1 ? "review" : "reviews"} this session · ${String(session.recalled)} recalled. ` : "No cards due right now. "}${session?.nextReviewAt ? `Next review: ${new Date(session.nextReviewAt).toLocaleString()}.` : ""}`
          }
          action={
            <div className="flex flex-wrap justify-center gap-2 pb-5">
              {flaggedAction}
              {navigationAction}
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
    <div className="flex gap-1.5 max-[640px]:w-full max-[640px]:[&>button]:min-w-0 max-[640px]:[&>button]:flex-1">
      {ratings.map(({ rating, label }) => (
        <Button
          variant={rating === "again" ? "destructive" : "secondary"}
          className={`min-h-12 min-w-[72px] flex-col rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm ${rating === "again" || rating === "hard" ? "text-[var(--status-warning-fg)]" : "text-[var(--status-success-fg)]"}`}
          key={rating}
          disabled={disabled}
          onClick={() => {
            onRate(rating);
          }}
          aria-keyshortcuts={keyboardActive ? shortcutLabel(shortcuts[rating]) : undefined}
        >
          {label}
          {keyboardActive ? ` · ${shortcuts[rating] === " " ? "Space" : shortcuts[rating]}` : ""}
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
