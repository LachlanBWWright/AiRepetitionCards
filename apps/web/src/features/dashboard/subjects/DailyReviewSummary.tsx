import { dailyReviewCopy } from "@recall/application";
import { Button } from "@recall/ui-web";

export function DailyReviewSummary({
  due,
  disabled,
  onReview,
}: {
  readonly due: number;
  readonly disabled: boolean;
  readonly onReview: () => void;
}) {
  const copy = dailyReviewCopy(due);
  return (
    <section
      aria-label="Daily review"
      className="flex items-center justify-between gap-4 border-b pb-5"
    >
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{copy.title}</h2>
        {due === 0 && (
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">{copy.description}</p>
        )}
      </div>
      {due > 0 && (
        <Button disabled={disabled} onClick={onReview} className="shrink-0">
          Review all due
        </Button>
      )}
    </section>
  );
}
