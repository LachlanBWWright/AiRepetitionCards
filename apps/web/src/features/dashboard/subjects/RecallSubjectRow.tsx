import type { SubjectSummary, SubjectActivity } from "@recall/application";
import { Button } from "@/components/ui/Button";
import { BookOpen, MessageCircle, Sparkles } from "lucide-react";
export function RecallSubjectRow({
  row,
  disabled,
  onOpen,
}: {
  readonly row: SubjectSummary;
  readonly disabled: boolean;
  readonly onOpen: (activity: SubjectActivity) => void;
}) {
  return (
    <article className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-5 last:border-b-0 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: row.area.color }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <Button
            variant="link"
            className="h-auto max-w-full justify-start truncate p-0 text-base font-semibold text-foreground"
            disabled={disabled}
            onClick={() => {
              onOpen("overview");
            }}
          >
            {row.area.title}
          </Button>
          <p className="mt-1 text-sm text-muted-foreground">
            {row.area.cards.length} {row.area.cards.length === 1 ? "card" : "cards"} ·{" "}
            {row.due ? `${String(row.due)} due` : "Nothing due"}
            {row.suggested ? " · Follow-up available" : ""}
          </p>
        </div>
      </div>
      <div
        className="flex w-full flex-wrap gap-2 sm:w-auto"
        aria-label={`Activities for ${row.area.title}`}
      >
        <Button
          disabled={disabled || row.due === 0}
          onClick={() => {
            onOpen("review");
          }}
        >
          <BookOpen aria-hidden="true" />
          Review
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            onOpen("tutor");
          }}
        >
          <MessageCircle aria-hidden="true" />
          Tutor
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            onOpen("improve");
          }}
        >
          <Sparkles aria-hidden="true" />
          Improve
        </Button>
      </div>
    </article>
  );
}
