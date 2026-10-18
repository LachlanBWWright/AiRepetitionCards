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
      <span
        className={`w-fit rounded-full bg-muted px-2 py-1 text-xs capitalize ${evaluation.result === "incorrect" ? "text-rose-400" : evaluation.result === "uncertain" ? "text-amber-300" : evaluation.result === "mastered" ? "text-emerald-300" : "text-blue-300"}`}
      >
        {evaluation.result}
      </span>
      <span>{Math.round(evaluation.confidence * 100)}% confidence</span>
      {children}
    </div>
  );
}
