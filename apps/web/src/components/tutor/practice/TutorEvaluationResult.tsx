import { StatusBadge } from "@recall/ui-web";
import type { AnswerEvaluation } from "@recall/ai-core";
import type { ReactNode } from "react";

export function TutorEvaluationResult({
  evaluation,
  children,
}: {
  readonly evaluation: AnswerEvaluation;
  readonly children: ReactNode;
}) {
  return (
    <div className="mt-3 grid gap-2 text-sm" role="status">
      <StatusBadge
        tone={
          evaluation.result === "incorrect"
            ? "danger"
            : evaluation.result === "uncertain"
              ? "warning"
              : evaluation.result === "mastered"
                ? "success"
                : "neutral"
        }
      >
        {evaluation.result}
      </StatusBadge>
      <span>{Math.round(evaluation.confidence * 100)}% confidence</span>
      {children}
    </div>
  );
}
