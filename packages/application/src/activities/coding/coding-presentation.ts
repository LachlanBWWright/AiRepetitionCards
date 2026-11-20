import { Either, Schema } from "effect";
import {
  CodingPayloadSchema,
  type ActivityResponse,
  type ActivityResult,
  type CodingExecution,
  type LearningActivity,
} from "@recall/domain";

export function codingPresentation(activity: LearningActivity) {
  const decoded = Schema.decodeUnknownEither(CodingPayloadSchema)(activity.payload);
  if (Either.isLeft(decoded)) return null;
  return decoded.right;
}

/** Only a full Submit result may be offered to the learner for acceptance. */
export function codingSubmissionResult(
  activity: LearningActivity,
  response: ActivityResponse,
  execution: CodingExecution,
): ActivityResult {
  const score = execution.total > 0 ? execution.passed / execution.total : 0;
  return {
    evaluatorId: "recall.coding:tests",
    evaluatorVersion: "1",
    feedback:
      `${String(execution.passed)}/${String(execution.total)} downloaded tests passed. ${execution.failures.join("\n")}`
        .trim()
        .slice(0, 8000),
    evidence: activity.objectiveIds.map((objectiveId) => ({
      objectiveId,
      dimension: "application",
      score,
      confidence: 0.8,
      assistance: response.assistance,
      assessment: "deterministic",
      explanation:
        "Full submission evaluated against the authored downloaded test cases; passing these cases does not prove correctness for every input.",
    })),
  };
}
