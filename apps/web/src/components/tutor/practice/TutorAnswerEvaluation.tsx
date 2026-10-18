import { TutorEvaluationResult } from "./TutorEvaluationResult";
import type { AnswerEvaluation } from "@recall/ai-core";
import { Button } from "@recall/ui-web";
type Props = {
  readonly evaluation: AnswerEvaluation;
  readonly objectiveTitle: string;
  readonly busy: boolean;
  readonly canPropose: boolean;
  readonly onPropose: () => void;
};
export function TutorAnswerEvaluation({
  evaluation,
  objectiveTitle,
  busy,
  canPropose,
  onPropose,
}: Props) {
  return (
    <TutorEvaluationResult evaluation={evaluation}>
      <span>Objective: {objectiveTitle}</span>
      {evaluation.misconception && <p>{evaluation.misconception}</p>}
      {evaluation.suggestedAction === "propose-card" && canPropose && (
        <Button
          variant="secondary"
          size="small"
          type="button"
          disabled={busy}
          onClick={() => {
            onPropose();
          }}
        >
          {busy ? "Drafting…" : "Suggest a flashcard"}
        </Button>
      )}
    </TutorEvaluationResult>
  );
}
