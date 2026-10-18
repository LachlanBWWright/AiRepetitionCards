import { Effect, Schema } from "effect";
import {
  CodingPayloadSchema,
  type ActivityResponse,
  type LearningActivity,
  type UnderstandingEvidence,
} from "@recall/domain";

export type ActivityFailure = {
  readonly _tag: "ActivityFailure";
  readonly reason: "invalid-input" | "unsupported" | "assessment-unavailable" | "conflict";
  readonly message: string;
};
export const failure = (reason: ActivityFailure["reason"], message: string): ActivityFailure => ({
  _tag: "ActivityFailure",
  reason,
  message,
});
const text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000));
const prompts = Schema.Array(text).pipe(Schema.minItems(1), Schema.maxItems(10));
const RubricPayload = Schema.Struct({
  prompts,
  rubric: text,
  reference: Schema.String.pipe(Schema.maxLength(20_000)),
});
const ChoicePayload = Schema.Struct({
  prompt: text,
  options: Schema.Array(
    Schema.Struct({ id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)), text }),
  ).pipe(Schema.minItems(2), Schema.maxItems(8)),
  correctOptionIds: Schema.Array(
    Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  ).pipe(Schema.minItems(1), Schema.maxItems(8)),
  explanation: text,
}).pipe(
  Schema.filter(
    (content) =>
      new Set(content.options.map((option) => option.id)).size === content.options.length &&
      new Set(content.correctOptionIds).size === content.correctOptionIds.length &&
      content.correctOptionIds.every((id) => content.options.some((option) => option.id === id)),
  ),
);
export type ActivityPresentation = {
  readonly prompts: readonly string[];
  readonly options: readonly { readonly id: string; readonly text: string }[];
  readonly rubric: string;
  readonly reference: string;
  readonly code: boolean;
};
/** Plugins are trusted registrations. Imported activity payloads cannot register implementations. */
export type ActivityPlugin = {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly capabilities: {
    readonly offline: boolean;
    readonly execution: boolean;
    readonly assessment: "self" | "deterministic" | "ai" | "human";
    readonly assessmentMethods?: readonly UnderstandingEvidence["assessment"][];
    readonly platforms: readonly ("web" | "native")[];
  };
  readonly migrate?: (
    payload: unknown,
    fromVersion: number,
  ) => Effect.Effect<unknown, ActivityFailure>;
  readonly present: (payload: unknown) => Effect.Effect<ActivityPresentation, ActivityFailure>;
  readonly assess: (
    activity: LearningActivity,
    response: ActivityResponse,
  ) => Effect.Effect<unknown, ActivityFailure>;
};
export type ActivityRegistry = readonly ActivityPlugin[];
const decodeRubric = (input: unknown) =>
  Schema.decodeUnknown(RubricPayload)(input).pipe(
    Effect.mapError(() =>
      failure("invalid-input", "This activity needs valid prompts, a rubric, and reference text."),
    ),
  );
const decodeChoice = (input: unknown) =>
  Schema.decodeUnknown(ChoicePayload)(input).pipe(
    Effect.mapError(() =>
      failure("invalid-input", "Multiple choice needs unique choices and valid correct choices."),
    ),
  );
function hasValidRubricResponse(
  response: ActivityResponse,
  prompts: readonly string[],
  pluginId: string,
): boolean {
  const presented = response.presentedPrompts;
  return (
    response.answers.length === (presented ?? prompts).length &&
    (presented === undefined ||
      (presented.length >= prompts.length &&
        (pluginId === "recall.interrogation" || presented.length === prompts.length) &&
        prompts.every((prompt, index) => presented[index] === prompt))) &&
    response.answers.every((answer) => answer.trim().length > 0) &&
    response.selectedOptionIds.length === 0
  );
}

function rubricPlugin(
  id: string,
  label: string,
  dimension: UnderstandingEvidence["dimension"],
  code = false,
): ActivityPlugin {
  return {
    id,
    version: 1,
    label,
    capabilities: {
      offline: true,
      execution: false,
      assessment: "self",
      assessmentMethods: code ? ["self", "ai", "deterministic"] : ["self", "ai"],
      platforms: ["web", "native"],
    },
    present: (input) =>
      (code && typeof input === "object" && input !== null && "tests" in input
        ? Schema.decodeUnknown(CodingPayloadSchema)(input).pipe(
            Effect.mapError(() =>
              failure(
                "invalid-input",
                "Coding tests must contain JSON inputs and expected values.",
              ),
            ),
          )
        : decodeRubric(input)
      ).pipe(Effect.map((content) => ({ ...content, options: [], code }))),
    assess: (activity, response) =>
      decodeRubric(activity.payload).pipe(
        Effect.flatMap((content) => {
          if (!hasValidRubricResponse(response, content.prompts, id))
            return Effect.fail(
              failure("invalid-input", "Answer each prompt before assessing your work."),
            );
          return Effect.succeed({
            evaluatorId: `${id}:self-rubric`,
            evaluatorVersion: "1",
            feedback:
              "Self-assessment recorded against the rubric. This does not independently verify understanding.",
            evidence: activity.objectiveIds.map((objectiveId) => ({
              objectiveId,
              dimension,
              score: response.selfScore,
              confidence: 0.4,
              assistance: response.assistance,
              assessment: "self" as const,
              explanation: content.rubric,
            })),
          });
        }),
      ),
  };
}
export const builtinActivityRegistry: ActivityRegistry = [
  rubricPlugin("recall.basic", "Recall", "recall"),
  rubricPlugin("recall.cloze", "Cloze", "recall"),
  rubricPlugin("recall.short-answer", "Short answer", "reasoning"),
  rubricPlugin("recall.coding", "Coding exercise", "application", true),
  rubricPlugin("recall.interrogation", "Structured interrogation", "reasoning"),
  {
    id: "recall.multiple-choice",
    version: 1,
    label: "Multiple choice",
    capabilities: {
      offline: true,
      execution: false,
      assessment: "deterministic",
      platforms: ["web", "native"],
    },
    present: (input) =>
      decodeChoice(input).pipe(
        Effect.map((content) => ({
          prompts: [content.prompt],
          options: content.options,
          rubric: "Select every correct choice. Full credit requires an exact match.",
          reference: content.explanation,
          code: false,
        })),
      ),
    assess: (activity, response) =>
      decodeChoice(activity.payload).pipe(
        Effect.flatMap((content) => {
          const selected = new Set(response.selectedOptionIds);
          if (
            selected.size === 0 ||
            selected.size !== response.selectedOptionIds.length ||
            [...selected].some((id) => !content.options.some((option) => option.id === id)) ||
            response.answers.length > 0
          )
            return Effect.fail(failure("invalid-input", "Select valid choices before submitting."));
          const correct =
            selected.size === content.correctOptionIds.length &&
            content.correctOptionIds.every((id) => selected.has(id));
          return Effect.succeed({
            evaluatorId: "recall.multiple-choice:exact-match",
            evaluatorVersion: "1",
            feedback: `${correct ? "Correct." : "Not quite."} ${content.explanation}`,
            evidence: activity.objectiveIds.map((objectiveId) => ({
              objectiveId,
              dimension: "recognition" as const,
              score: correct ? 1 : 0,
              confidence: 1,
              assistance: response.assistance,
              assessment: "deterministic" as const,
              explanation:
                "Exact-match recognition result; a correct selection can still be guessed.",
            })),
          });
        }),
      ),
  },
];
export function findActivityPlugin(
  registry: ActivityRegistry,
  activity: LearningActivity,
): ActivityPlugin | undefined {
  const matches = registry.filter(
    (plugin) => plugin.id === activity.pluginId && plugin.version === activity.pluginVersion,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
