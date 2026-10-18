import type { LearningAttempt } from "@recall/domain";

export type LearningDiagnosticObjective = {
  readonly id: string;
  readonly title: string;
};

export type ObjectiveDiagnostic = {
  readonly objectiveId: string;
  readonly title: string;
  readonly status: "needs-attention" | "developing" | "no-evidence";
  readonly independentEvidenceCount: number;
  readonly assistedEvidenceCount: number;
  readonly selfReportedEvidenceCount: number;
  readonly lowConfidenceOrScoreDimensions: readonly string[];
  readonly latestIndependentEvidenceAt: string | null;
  readonly recommendation: "targeted-practice" | null;
};

const LOW_SCORE_THRESHOLD = 0.6;
const STALE_EVIDENCE_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Builds a deterministic, advisory view from accepted learning history. It does not
 * mutate history or alter review schedules. `now` is explicit so callers and tests
 * control the recency window. Future or invalid acceptance times are excluded from
 * this snapshot; an invalid `now` therefore produces no evidence.
 */
export function diagnoseLearningObjectives(
  objectives: readonly LearningDiagnosticObjective[],
  attempts: readonly LearningAttempt[],
  now: string,
): readonly ObjectiveDiagnostic[] {
  const nowMs = Date.parse(now);
  return objectives.map((objective) => {
    const snapshotAttempts = attempts.filter(
      (attempt) => Number.isFinite(nowMs) && Date.parse(attempt.acceptedAt) <= nowMs,
    );
    const evidence = snapshotAttempts.flatMap((attempt) =>
      attempt.result.evidence
        .filter((entry) => entry.objectiveId === objective.id)
        .map((entry) => ({ entry, acceptedAt: attempt.acceptedAt, attemptId: attempt.id })),
    );
    const independent = evidence.filter(
      ({ entry }) => entry.assessment !== "self" && entry.assistance === "none",
    );
    const assistedEvidenceCount = evidence.filter(
      ({ entry }) => entry.assistance !== "none",
    ).length;
    const selfReportedEvidenceCount = evidence.filter(
      ({ entry }) => entry.assessment === "self",
    ).length;
    const eligibleIndependent = independent.sort(
      (left, right) =>
        Date.parse(right.acceptedAt) - Date.parse(left.acceptedAt) ||
        left.attemptId.localeCompare(right.attemptId),
    );
    const latestByDimension = new Map<string, (typeof eligibleIndependent)[number]>();
    for (const item of eligibleIndependent) {
      if (!latestByDimension.has(item.entry.dimension))
        latestByDimension.set(item.entry.dimension, item);
    }
    const latestIndependentEvidenceAt = eligibleIndependent[0]?.acceptedAt ?? null;
    const lowConfidenceOrScoreDimensions = Array.from(latestByDimension.values())
      .filter(({ entry }) => entry.score < LOW_SCORE_THRESHOLD || entry.confidence < 0.5)
      .map(({ entry }) => entry.dimension)
      .sort();
    const stale =
      latestIndependentEvidenceAt !== null &&
      Number.isFinite(nowMs) &&
      nowMs - Date.parse(latestIndependentEvidenceAt) > STALE_EVIDENCE_MS;
    const hasEvidence = evidence.length > 0;
    const needsAttention =
      lowConfidenceOrScoreDimensions.length > 0 ||
      (hasEvidence && eligibleIndependent.length === 0) ||
      stale;

    return {
      objectiveId: objective.id,
      title: objective.title,
      status: !hasEvidence ? "no-evidence" : needsAttention ? "needs-attention" : "developing",
      independentEvidenceCount: independent.length,
      assistedEvidenceCount,
      selfReportedEvidenceCount,
      lowConfidenceOrScoreDimensions,
      latestIndependentEvidenceAt,
      recommendation: needsAttention || !hasEvidence ? "targeted-practice" : null,
    };
  });
}
