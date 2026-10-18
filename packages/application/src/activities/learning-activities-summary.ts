import type { Assessment, LearningActivity, LearningAttempt } from "@recall/domain";

/** Self reports and assisted responses remain separate from independent evidence. No mastery claim. */
export function summarizeUnderstanding(attempts: readonly LearningAttempt[], objectiveId: string) {
  const entries = attempts.flatMap((attempt) =>
    attempt.result.evidence.filter((entry) => entry.objectiveId === objectiveId),
  );
  const dimensions = ["recall", "recognition", "reasoning", "application", "transfer"] as const;
  return dimensions.map((dimension) => {
    const evidence = entries.filter((entry) => entry.dimension === dimension);
    const independent = evidence.filter(
      (entry) => entry.assessment !== "self" && entry.assistance === "none",
    );
    const weight = independent.reduce((total, entry) => total + entry.confidence, 0);
    return {
      dimension,
      attempts: evidence.length,
      selfReports: evidence.filter((entry) => entry.assessment === "self").length,
      assisted: evidence.filter((entry) => entry.assistance !== "none").length,
      value:
        weight > 0
          ? independent.reduce((total, entry) => total + entry.score * entry.confidence, 0) / weight
          : null,
    };
  });
}
export function activityFromCard(card: Assessment, areaId: string): LearningActivity {
  return {
    id: `card:${card.id}`,
    areaId,
    title: card.front.slice(0, 300),
    pluginId: card.cloze ? "recall.cloze" : "recall.basic",
    pluginVersion: 1,
    revision: 1,
    objectiveIds: card.objectiveIds?.length ? card.objectiveIds : [`card-objective:${card.id}`],
    fallback: card.front,
    payload: {
      prompts: [card.front],
      rubric: "Compare your unaided answer with the reference answer.",
      reference: card.back,
    },
  };
}
