import { RubricScoreSelect } from "../RubricScoreSelect";
import { Button } from "@recall/ui-web";
import type { useLearningActivities } from "@recall/react";

export function CodingRubricFallback({
  model,
  disabled,
}: {
  readonly model: ReturnType<typeof useLearningActivities>;
  readonly disabled: boolean;
}) {
  if ((model.coding.available && !model.coding.message) || model.result) return null;
  return (
    <div className="grid gap-2">
      <p>
        Execution is unavailable. Your code is retained. You can save progress or explicitly assess
        your solution against the rubric.
      </p>
      <RubricScoreSelect
        value={model.response.selfScore}
        disabled={disabled}
        onSelect={(score) => {
          model.setResponse((current) => ({ ...current, selfScore: score }));
        }}
      />
      <Button disabled={disabled || !model.response.answers[0]?.trim()} onClick={model.assess}>
        Propose self-assessment
      </Button>
    </div>
  );
}
