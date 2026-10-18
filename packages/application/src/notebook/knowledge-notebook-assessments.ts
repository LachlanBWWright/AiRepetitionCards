import { Effect, Schema } from "effect";
import { ObjectiveIdSchema } from "@recall/domain";
import {
  read,
  Time,
  Text,
  type KnowledgeNotebook,
  type NotebookFailure,
  type NotebookEvidence,
} from "./knowledge-notebook-schema";
export const NotebookAssessmentSchema = Schema.Struct({
  conceptId: ObjectiveIdSchema,
  status: Schema.Literal("unassessed", "uncertain", "demonstrated", "needs-reinforcement"),
  evidenceCount: Time,
  reason: Text,
});
export type NotebookAssessment = typeof NotebookAssessmentSchema.Type;
export function deriveNotebookAssessmentValues(
  notebook: KnowledgeNotebook,
): readonly NotebookAssessment[] {
  return notebook.concepts.map((concept) => {
    const entries = notebook.evidence
      .filter((entry) => entry.conceptId === concept.id)
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const latest = entries.at(-1);
    const negative = (entry: NotebookEvidence) =>
      entry.kind === "review"
        ? entry.reviewEvent.rating === "again" || entry.reviewEvent.rating === "hard"
        : entry.evaluation.result === "incorrect" || entry.evaluation.result === "partial";
    const positive = (entry: NotebookEvidence) =>
      entry.kind === "review"
        ? entry.reviewEvent.rating === "good" || entry.reviewEvent.rating === "easy"
        : entry.evaluation.result === "mastered" &&
          entry.evaluation.confidence >= 0.7 &&
          entry.learnerConfidence !== "guess";
    const lastFailure = entries.map(negative).lastIndexOf(true);
    const successes = entries
      .slice(lastFailure + 1)
      .filter((entry) => entry.kind === "tutor" && positive(entry));
    const distinctPrompts = new Set(
      successes.map((entry) =>
        entry.kind === "tutor" ? entry.question.trim().toLocaleLowerCase("en-US") : "",
      ),
    );
    const hasTransferEvidence = successes.some(
      (entry) =>
        entry.kind === "tutor" &&
        entry.investigationMode !== undefined &&
        ["explain", "apply", "vary", "predict"].includes(entry.investigationMode),
    );
    const status = !latest
      ? "unassessed"
      : negative(latest)
        ? "needs-reinforcement"
        : successes.length >= 2 &&
            distinctPrompts.size >= 2 &&
            hasTransferEvidence &&
            positive(latest)
          ? "demonstrated"
          : "uncertain";
    return {
      conceptId: concept.id,
      status,
      evidenceCount: entries.length,
      reason:
        status === "unassessed"
          ? "No observations yet."
          : status === "needs-reinforcement"
            ? "The latest observation exposed a gap; revisit this concept."
            : status === "demonstrated"
              ? "Distinct tutor answers, including explanation or application, support understanding; recall alone does not establish it and future failures can reopen it."
              : "Evidence is limited or tentative; one answer does not establish understanding.",
    };
  });
}
export function deriveNotebookAssessments(
  input: unknown,
): Effect.Effect<readonly NotebookAssessment[], NotebookFailure> {
  return read(input).pipe(Effect.map(deriveNotebookAssessmentValues));
}
