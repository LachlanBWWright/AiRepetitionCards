import { Effect, Schema } from "effect";
import {
  AnswerEvaluationSchema,
  KnowledgeGapSchema,
  MAX_TUTOR_SESSION_OBSERVATIONS,
  TutorContextSchema,
  TutorObservationHistorySchema,
  combineObjectiveGapsWithTutorEvidence,
} from "@recall/ai-core";

export type TutorEvidenceFailure = {
  readonly _tag: "TutorEvidenceFailure";
  readonly reason: "invalid-evidence" | "invalid-objective";
};
const failure = (reason: TutorEvidenceFailure["reason"]): TutorEvidenceFailure => ({
  _tag: "TutorEvidenceFailure",
  reason,
});

/** Retain validated recent evidence independently of the current question/evaluation. */
export function accumulateTutorObservations(previous: unknown, observation: unknown) {
  return Effect.gen(function* () {
    const history = yield* Schema.decodeUnknown(TutorObservationHistorySchema)(previous).pipe(
      Effect.mapError(() => failure("invalid-evidence")),
    );
    const next = yield* Schema.decodeUnknown(AnswerEvaluationSchema)(observation).pipe(
      Effect.mapError(() => failure("invalid-evidence")),
    );
    return [...history, next].slice(-MAX_TUTOR_SESSION_OBSERVATIONS);
  });
}

/** Shared objective choice: explicit learner choice, then strongest gap/evidence, stable IDs. */
export function selectTutorQuizObjective(
  areaInput: unknown,
  gapsInput: unknown,
  evidenceInput: unknown,
  selectedObjectiveId: string | null = null,
) {
  return Effect.gen(function* () {
    const area = yield* Schema.decodeUnknown(TutorContextSchema.fields.knowledgeArea)(
      areaInput,
    ).pipe(Effect.mapError(() => failure("invalid-objective")));
    const gaps = yield* Schema.decodeUnknown(
      Schema.Array(KnowledgeGapSchema).pipe(Schema.maxItems(200)),
    )(gapsInput).pipe(Effect.mapError(() => failure("invalid-evidence")));
    const evidence = yield* Schema.decodeUnknown(TutorObservationHistorySchema)(evidenceInput).pipe(
      Effect.mapError(() => failure("invalid-evidence")),
    );
    const knownIds = new Set<string>(area.objectives.map((objective) => objective.id));
    if (selectedObjectiveId !== null && !knownIds.has(selectedObjectiveId))
      return yield* Effect.fail(failure("invalid-objective"));
    const strength = (objectiveId: string) =>
      evidence
        .filter(
          (item) =>
            item.objectiveId === objectiveId &&
            item.confidence >= 0.5 &&
            (item.result === "incorrect" || item.result === "partial"),
        )
        .reduce((total, item) => total + (item.result === "incorrect" ? 2 : 1), 0);
    const combined = [
      ...combineObjectiveGapsWithTutorEvidence(
        area,
        gaps.filter((gap) => knownIds.has(gap.objectiveId)),
        evidence,
      ),
    ].sort(
      (left, right) =>
        Number(right.severity === "high") - Number(left.severity === "high") ||
        strength(right.objectiveId) - strength(left.objectiveId) ||
        right.recentFailureCount - left.recentFailureCount ||
        (left.objectiveId < right.objectiveId ? -1 : left.objectiveId > right.objectiveId ? 1 : 0),
    );
    const objectiveId =
      selectedObjectiveId ??
      combined[0]?.objectiveId ??
      [...area.objectives].sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      )[0]?.id;
    const objective = area.objectives.find((item) => item.id === objectiveId) ?? null;
    return {
      objective,
      gaps: combined,
      gap: combined.find((item) => item.objectiveId === objectiveId) ?? null,
    };
  });
}
