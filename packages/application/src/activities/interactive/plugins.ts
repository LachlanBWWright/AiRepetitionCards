import { Effect, Schema } from "effect";
import {
  OrderingPayloadSchema,
  MatchingPayloadSchema,
  CodeTracingPayloadSchema,
  ActivityResultSchema,
  type ActivityResponse,
  type LearningActivity,
} from "@recall/domain";
import { failure, type ActivityPlugin } from "../learning-activities-plugins";
import { shuffleInteractiveItems, normalizeTracingOutput } from "./presentation";

const capabilities = {
  offline: true,
  execution: false,
  assessment: "deterministic",
  platforms: ["web", "native"],
} as const;
const decode = <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
  Schema.decodeUnknown(schema)(input).pipe(
    Effect.mapError(() => failure("invalid-input", "The interactive activity content is invalid.")),
  );
const permutation = (values: readonly string[], ids: readonly string[]) =>
  values.length === ids.length &&
  new Set(values).size === ids.length &&
  values.every((id) => ids.includes(id));
function validInteraction(response: ActivityResponse, seed?: number): boolean {
  const interaction = response.interaction;
  return (
    !interaction ||
    ((interaction.seed === undefined || seed === undefined || interaction.seed === seed) &&
      (!(interaction.hints && interaction.hints > 0) || response.assistance !== "none") &&
      !(interaction.firstTry === true && (interaction.retries ?? 0) > 0))
  );
}
function result(
  activity: LearningActivity,
  response: ActivityResponse,
  correct: boolean,
  explanation: string,
) {
  const retries = response.interaction?.retries ?? 0;
  const hints = response.interaction?.hints ?? 0;
  return decode(ActivityResultSchema, {
    evaluatorId: `${activity.pluginId}:exact-match`,
    evaluatorVersion: "1",
    feedback: `${correct ? "Correct." : "Not quite."} ${explanation}`,
    evidence: activity.objectiveIds.map((objectiveId) => ({
      objectiveId,
      dimension: "reasoning",
      score: correct ? 1 : 0,
      confidence: 1,
      assistance: response.assistance,
      assessment: "deterministic",
      explanation: `Exact-match result for the submitted response; assistance: ${response.assistance}; hints: ${String(hints)}; retries: ${String(retries)}. First try: ${response.interaction?.firstTry === true ? "reported" : "not established"}.`,
    })),
  });
}
const invalid = () =>
  Effect.fail(
    failure(
      "invalid-input",
      "Complete the activity with valid choices and interaction evidence before submitting.",
    ),
  );
export const orderingActivityPlugin: ActivityPlugin = {
  id: "recall.ordering",
  version: 1,
  label: "Ordering",
  capabilities,
  present: (input) =>
    decode(OrderingPayloadSchema, input).pipe(
      Effect.map((content) => {
        const seed = content.seed ?? 1;
        return {
          prompts: [content.prompt],
          options: [],
          rubric: "Arrange every item in the correct order.",
          reference: content.explanation,
          code: false,
          interactive: {
            kind: "ordering" as const,
            seed,
            items: shuffleInteractiveItems(content.items, seed),
          },
        };
      }),
    ),
  assess: (activity, response) =>
    decode(OrderingPayloadSchema, activity.payload).pipe(
      Effect.flatMap((content) => {
        const ids = content.items.map((item) => item.id);
        if (
          response.answers.length !== 0 ||
          !permutation(response.selectedOptionIds, ids) ||
          !validInteraction(response, content.seed ?? 1)
        )
          return invalid();
        return result(
          activity,
          response,
          ids.every((id, index) => response.selectedOptionIds[index] === id),
          content.explanation,
        );
      }),
    ),
};
export const matchingActivityPlugin: ActivityPlugin = {
  id: "recall.matching",
  version: 1,
  label: "Matching",
  capabilities,
  present: (input) =>
    decode(MatchingPayloadSchema, input).pipe(
      Effect.map((content) => {
        const seed = content.seed ?? 1;
        const left = shuffleInteractiveItems(
          content.pairs.map((pair) => ({ id: pair.id, text: pair.left })),
          seed,
        );
        let right = shuffleInteractiveItems(
          content.pairs.map((pair) => ({ id: pair.id, text: pair.right })),
          seed ^ 0x9e3779b9,
        );
        if (right.every((item, index) => item.id === left[index]?.id))
          right = [...right.slice(1), ...right.slice(0, 1)];
        return {
          prompts: [content.prompt],
          options: [],
          rubric: "Match each left item to one right item.",
          reference: content.explanation,
          code: false,
          interactive: { kind: "matching" as const, seed, left, right },
        };
      }),
    ),
  assess: (activity, response) =>
    decode(MatchingPayloadSchema, activity.payload).pipe(
      Effect.flatMap((content) => {
        const ids = content.pairs.map((pair) => pair.id);
        const seed = content.seed ?? 1;
        const mapping = Schema.decodeUnknownEither(
          Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.String })),
        )(response.answers[0]);
        if (
          response.selectedOptionIds.length !== 0 ||
          response.answers.length !== 1 ||
          mapping._tag === "Left" ||
          !validInteraction(response, seed)
        )
          return invalid();
        if (
          !permutation(Object.keys(mapping.right), ids) ||
          !permutation(Object.values(mapping.right), ids)
        )
          return invalid();
        return result(
          activity,
          response,
          ids.every((id) => mapping.right[id] === id),
          content.explanation,
        );
      }),
    ),
};
export const codeTracingActivityPlugin: ActivityPlugin = {
  id: "recall.code-tracing",
  version: 1,
  label: "Code tracing",
  capabilities,
  present: (input) =>
    decode(CodeTracingPayloadSchema, input).pipe(
      Effect.map((content) => ({
        prompts: [content.prompt],
        options: [],
        rubric: "Trace the code and enter its output. Code is never executed.",
        reference: content.explanation,
        code: false,
        interactive: {
          kind: "code-tracing" as const,
          code: content.code,
          language: content.language,
        },
      })),
    ),
  assess: (activity, response) =>
    decode(CodeTracingPayloadSchema, activity.payload).pipe(
      Effect.flatMap((content) => {
        const answer = response.answers[0];
        if (
          response.answers.length !== 1 ||
          answer === undefined ||
          response.selectedOptionIds.length !== 0 ||
          !validInteraction(response)
        )
          return invalid();
        return result(
          activity,
          response,
          normalizeTracingOutput(answer) === normalizeTracingOutput(content.expectedOutput),
          content.explanation,
        );
      }),
    ),
};
export const interactiveActivityPlugins = [
  orderingActivityPlugin,
  matchingActivityPlugin,
  codeTracingActivityPlugin,
] as const;
