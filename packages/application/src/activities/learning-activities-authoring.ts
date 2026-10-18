import { Effect, Schema } from "effect";
import { CodingPayloadSchema, type LearningActivity } from "@recall/domain";
import { failure, type ActivityFailure } from "./learning-activities-plugins";

export type ActivityAuthoringField = {
  readonly key: string;
  readonly label: string;
  readonly initial: string;
  readonly multiline: boolean;
};
export function activityAuthoringFields(pluginId: string): readonly ActivityAuthoringField[] {
  if (pluginId === "recall.multiple-choice")
    return [
      {
        key: "prompt",
        label: "Question",
        initial: "Which data structure follows first-in, first-out order?",
        multiline: true,
      },
      {
        key: "options",
        label: "Choices (one per line)",
        initial: "Stack\nQueue\nSet",
        multiline: true,
      },
      {
        key: "correct",
        label: "Correct choice numbers (comma separated)",
        initial: "2",
        multiline: false,
      },
      {
        key: "reference",
        label: "Feedback",
        initial: "A queue removes elements in the order they were added.",
        multiline: true,
      },
    ];
  const interrogation = pluginId === "recall.interrogation";
  const coding = pluginId === "recall.coding";
  return [
    {
      key: "prompt",
      label: interrogation ? "Question stages (separate with a blank line)" : "Prompt",
      initial: interrogation
        ? "Explain what a queue does.\n\nWhy is a queue suitable for a breadth-first search?\n\nDescribe a different real-world use for a queue."
        : coding
          ? "Write a JavaScript function solve(values) that returns the sum of an array of numbers. Include how you would test empty and negative inputs, and explain its complexity."
          : "Explain how a queue differs from a stack.",
      multiline: true,
    },
    {
      key: "rubric",
      label: "Assessment rubric",
      initial: coding
        ? "Correctly sums every element, returns zero for an empty array, handles negative numbers, and explains O(n) time and O(1) extra space."
        : "An accurate explanation, a justified example, and an application in a new context.",
      multiline: true,
    },
    {
      key: "reference",
      label: "Reference answer (optional)",
      initial: coding
        ? "function solve(values) { return values.reduce((total, value) => total + value, 0); }"
        : "A queue is FIFO; a stack is LIFO. A queue supports breadth-first traversal by processing the earliest discovered nodes first.",
      multiline: true,
    },
    ...(coding
      ? [
          {
            key: "tests",
            label: "Test cases (JSON input arrays and expected values)",
            initial:
              '[{"input":[[1,2,3]],"expected":6},{"input":[[]],"expected":0},{"input":[[-2,1]],"expected":-1}]',
            multiline: true,
          },
        ]
      : []),
  ];
}
export function buildAuthoredLearningActivity(
  input: {
    readonly id: string;
    readonly areaId: string;
    readonly title: string;
    readonly pluginId: string;
    readonly objectiveId: string;
    readonly fields: Readonly<Record<string, string>>;
  },
  validate: (input: unknown) => Effect.Effect<LearningActivity, ActivityFailure>,
): Effect.Effect<LearningActivity, ActivityFailure> {
  const prompt = input.fields.prompt ?? "";
  const reference = input.fields.reference ?? "";
  const codingTests =
    input.pluginId === "recall.coding"
      ? Schema.decodeUnknownEither(Schema.parseJson(CodingPayloadSchema.fields.tests))(
          input.fields.tests ??
            '[{"input":[[1,2,3]],"expected":6},{"input":[[]],"expected":0},{"input":[[-2,1]],"expected":-1}]',
        )
      : null;
  if (codingTests && codingTests._tag === "Left")
    return Effect.fail(
      failure("invalid-input", "Tests must be JSON objects with input arrays and expected values."),
    );
  const payload =
    input.pluginId === "recall.multiple-choice"
      ? {
          prompt,
          options: (input.fields.options ?? "")
            .split("\n")
            .map((value, index) => ({ id: String(index + 1), text: value.trim() })),
          correctOptionIds: (input.fields.correct ?? "").split(",").map((value) => value.trim()),
          explanation: reference,
        }
      : {
          ...(codingTests ? { language: "javascript", tests: codingTests.right } : {}),
          prompts:
            input.pluginId === "recall.interrogation"
              ? prompt.split(/\n\s*\n/).map((value) => value.trim())
              : [prompt],
          rubric: input.fields.rubric ?? "",
          reference,
        };
  return validate({
    id: input.id,
    areaId: input.areaId,
    title: input.title.trim(),
    pluginId: input.pluginId,
    pluginVersion: 1,
    revision: 1,
    objectiveIds: [input.objectiveId],
    fallback: prompt,
    payload,
  });
}
