import { TutorEvaluationResult } from "../TutorEvaluationResult";
import type { TargetedQuizSession } from "@recall/ai-core";
import { Button, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
type Props = {
  readonly item: TargetedQuizSession["questions"][number];
  readonly index: number;
  readonly busy: boolean;
  readonly pending: boolean;
  readonly canSubmit: boolean;
  readonly onAnswerChange: (answer: string) => void;
  readonly onSubmit: () => void;
};
export function TutorQuizQuestion({
  item,
  index,
  busy,
  pending,
  canSubmit,
  onAnswerChange,
  onSubmit,
}: Props) {
  return (
    <div className="grid gap-2 border-t py-3">
      <strong>
        {index + 1}. {item.prompt}
      </strong>
      {!item.evaluation ? (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            const submittedAnswer = item.learnerAnswer?.trim();
            if (!submittedAnswer || !canSubmit) return;
            onSubmit();
          }}
        >
          <Label className="sr-only" htmlFor={`tutor-quiz-answer-${String(index)}`}>
            Your answer to question {index + 1}
          </Label>
          <Textarea
            id={`tutor-quiz-answer-${String(index)}`}
            disabled={pending}
            value={item.learnerAnswer ?? ""}
            onChange={(event) => {
              onAnswerChange(event.target.value);
            }}
            placeholder="Write your answer…"
            maxLength={8000}
            required
          />
          <Button
            variant="secondary"
            size="small"
            type="submit"
            disabled={busy || !item.learnerAnswer?.trim() || !canSubmit}
          >
            Check answer
          </Button>
        </form>
      ) : (
        <TutorEvaluationResult evaluation={item.evaluation}>
          <p>{item.evaluation.feedback}</p>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold leading-6">Compare with a sample answer</h3>
            <div>
              <p>{item.expectedAnswer}</p>
            </div>
          </section>
        </TutorEvaluationResult>
      )}
    </div>
  );
}
