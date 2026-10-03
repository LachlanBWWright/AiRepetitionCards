import type { KnowledgeArea } from "@recall/domain";
import type { AnswerEvaluation, KnowledgeGap } from "./index";

/** AI observations supplement deterministic signals; they never change review state. */
export function combineObjectiveGapsWithTutorEvidence(
  knowledgeArea: KnowledgeArea,
  gaps: readonly KnowledgeGap[],
  evaluations: readonly AnswerEvaluation[],
): readonly KnowledgeGap[] {
  const objectives = new Map<string, KnowledgeArea["objectives"][number]>(
    knowledgeArea.objectives.map((objective) => [objective.id, objective]),
  );
  const observations = new Map<string, readonly AnswerEvaluation[]>();
  for (const evaluation of evaluations) {
    if (
      !evaluation.objectiveId ||
      !objectives.has(evaluation.objectiveId) ||
      evaluation.result === "mastered" ||
      evaluation.result === "uncertain"
    )
      continue;
    const previous = observations.get(evaluation.objectiveId) ?? [];
    const summary = evaluation.misconception ?? evaluation.feedback;
    if (previous.some((item) => (item.misconception ?? item.feedback) === summary)) continue;
    observations.set(evaluation.objectiveId, [...previous, evaluation]);
  }
  const result = gaps.map((gap) => {
    const evidence = observations.get(gap.objectiveId);
    if (!evidence?.length) return gap;
    observations.delete(gap.objectiveId);
    return {
      ...gap,
      severity: evidence.some((item) => item.result === "incorrect" && item.confidence >= 0.5)
        ? ("high" as const)
        : gap.severity,
      evidenceSummary: summarizeEvidence(evidence, gap.evidenceSummary),
    };
  });
  for (const [objectiveId, evidence] of observations) {
    const objective = objectives.get(objectiveId);
    if (!objective) continue;
    result.push({
      objectiveId,
      objectiveTitle: objective.title,
      kind: "tutor-observation",
      severity: evidence.some((item) => item.result === "incorrect" && item.confidence >= 0.5)
        ? "high"
        : "medium",
      cardCount: knowledgeArea.cards.filter((card) => card.objectiveIds.includes(objective.id))
        .length,
      dueCardCount: 0,
      recentFailureCount: 0,
      evidenceSummary: summarizeEvidence(evidence),
    });
  }
  return result;
}

function summarizeEvidence(evaluations: readonly AnswerEvaluation[], existing?: string): string {
  const summaries = evaluations.map(
    (evaluation) => evaluation.misconception ?? evaluation.feedback,
  );
  const text = [existing, `Tutor evidence: ${summaries.join(" ")}`].filter(Boolean).join(" ");
  return text.length <= 500 ? text : `${text.slice(0, 499)}…`;
}
