import { Effect, Schema } from "effect";
import {
  OrderingPayloadSchema,
  MatchingPayloadSchema,
  CodeTracingPayloadSchema,
  type LearningActivity,
} from "@recall/domain";
import { failure, type ActivityFailure } from "../learning-activities-plugins";
import type { ActivityAuthoringField } from "../learning-activities-authoring";

export function interactiveAuthoringFields(
  pluginId: string,
): readonly ActivityAuthoringField[] | undefined {
  if (!["recall.ordering", "recall.matching", "recall.code-tracing"].includes(pluginId))
    return undefined;
  const common = [
    { key: "prompt", label: "Prompt", initial: "Complete the activity.", multiline: true },
  ];
  const fields =
    pluginId === "recall.ordering"
      ? [
          {
            key: "items",
            label: "Items in correct order (one per line)",
            initial: "Plan\nImplement\nVerify",
            multiline: true,
          },
          { key: "seed", label: "Shuffle seed (0–4294967295)", initial: "1", multiline: false },
        ]
      : pluginId === "recall.matching"
        ? [
            {
              key: "pairs",
              label: "Pairs (one per line: left | right)",
              initial: "Queue | FIFO\nStack | LIFO",
              multiline: true,
            },
            { key: "seed", label: "Shuffle seed (0–4294967295)", initial: "1", multiline: false },
          ]
        : [
            {
              key: "code",
              label: "Code to trace (displayed, never executed)",
              initial:
                "let total = 0;\nfor (let i = 1; i <= 3; i++) total += i;\nconsole.log(total);",
              multiline: true,
            },
            { key: "language", label: "Language", initial: "javascript", multiline: false },
            { key: "expectedOutput", label: "Expected output", initial: "6", multiline: true },
          ];
  return [
    ...common,
    ...fields,
    {
      key: "reference",
      label: "Explanation",
      initial: "Explain the correct solution.",
      multiline: true,
    },
  ];
}

export function buildInteractivePayload(
  pluginId: string,
  fields: Readonly<Record<string, string>>,
): Effect.Effect<unknown, ActivityFailure> {
  const common = { prompt: fields.prompt ?? "", explanation: fields.reference ?? "" };
  const seedText = fields.seed ?? "1";
  const seed = Number(seedText);
  if (
    pluginId !== "recall.code-tracing" &&
    (!/^\d+$/.test(seedText) || !Number.isInteger(seed) || seed < 0 || seed > 4294967295)
  )
    return Effect.fail(
      failure("invalid-input", "Shuffle seed must be an integer between 0 and 4294967295."),
    );
  if (pluginId === "recall.ordering")
    return Schema.decodeUnknown(OrderingPayloadSchema)({
      ...common,
      seed,
      items: (fields.items ?? "")
        .split("\n")
        .map((text, index) => ({ id: String(index + 1), text: text.trim() })),
    }).pipe(
      Effect.mapError(() => failure("invalid-input", "Provide 2–20 nonempty ordered items.")),
    );
  if (pluginId === "recall.matching") {
    const lines = (fields.pairs ?? "").split("\n");
    if (lines.some((line) => line.split("|").length !== 2))
      return Effect.fail(failure("invalid-input", "Each pair needs exactly one | separator."));
    return Schema.decodeUnknown(MatchingPayloadSchema)({
      ...common,
      seed,
      pairs: lines.map((line, index) => {
        const [left, right] = line.split("|");
        return { id: String(index + 1), left: left?.trim(), right: right?.trim() };
      }),
    }).pipe(
      Effect.mapError(() => failure("invalid-input", "Provide 2–20 nonempty matching pairs.")),
    );
  }
  return Schema.decodeUnknown(CodeTracingPayloadSchema)({
    ...common,
    code: fields.code ?? "",
    language: fields.language ?? "",
    expectedOutput: fields.expectedOutput ?? "",
  }).pipe(
    Effect.mapError(() =>
      failure("invalid-input", "Provide a prompt, code, language and expected output."),
    ),
  );
}

/** Restores authored (correct) order, never the shuffled presentation. Compose into editor fields. */
export function interactiveActivityEditorFields(
  activity: LearningActivity,
): Readonly<Record<string, string>> | undefined {
  const payload = activity.payload;
  if (activity.pluginId === "recall.ordering") {
    const decoded = Schema.decodeUnknownEither(OrderingPayloadSchema)(payload);
    if (decoded._tag === "Right")
      return {
        prompt: decoded.right.prompt,
        reference: decoded.right.explanation,
        items: decoded.right.items.map((item) => item.text).join("\n"),
        seed: String(decoded.right.seed ?? 1),
      };
  }
  if (activity.pluginId === "recall.matching") {
    const decoded = Schema.decodeUnknownEither(MatchingPayloadSchema)(payload);
    if (decoded._tag === "Right")
      return {
        prompt: decoded.right.prompt,
        reference: decoded.right.explanation,
        pairs: decoded.right.pairs.map((pair) => `${pair.left} | ${pair.right}`).join("\n"),
        seed: String(decoded.right.seed ?? 1),
      };
  }
  if (activity.pluginId === "recall.code-tracing") {
    const decoded = Schema.decodeUnknownEither(CodeTracingPayloadSchema)(payload);
    if (decoded._tag === "Right")
      return {
        prompt: decoded.right.prompt,
        reference: decoded.right.explanation,
        code: decoded.right.code,
        language: decoded.right.language,
        expectedOutput: decoded.right.expectedOutput,
      };
  }
  return undefined;
}
