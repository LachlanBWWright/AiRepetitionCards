import { Effect, Schema } from "effect";
import { CodingPayloadSchema, CodingTestSchema } from "@recall/domain";
import { failure } from "../learning-activities-plugins";
import type { ActivityAuthoringField } from "../learning-activities-authoring";

export const codingAuthoringFields: readonly ActivityAuthoringField[] = [
  {
    key: "language",
    label: "Language (javascript, python, or rust)",
    initial: "javascript",
    multiline: false,
  },
  {
    key: "starterCode",
    label: "Starter code (solve function)",
    initial: "function solve(values) {\n  // Your solution\n}",
    multiline: true,
  },
  {
    key: "signature",
    label: "Function signature",
    initial: "solve(values) -> number",
    multiline: false,
  },
  {
    key: "constraints",
    label: "Constraints (one per line)",
    initial: "Input is an array of finite numbers.",
    multiline: true,
  },
  {
    key: "hints",
    label: "Hints (one per line)",
    initial: "Keep a running total.",
    multiline: true,
  },
  {
    key: "exampleTests",
    label: "Public examples (JSON input arrays and expected values)",
    initial: '[{"input":[[1,2,3]],"expected":6}]',
    multiline: true,
  },
  { key: "mode", label: "Mode (short-review or practice)", initial: "practice", multiline: false },
];

export function buildCodingAuthoringPayload(fields: Readonly<Record<string, string>>) {
  return Effect.gen(function* () {
    const tests = yield* Schema.decodeUnknown(Schema.parseJson(CodingPayloadSchema.fields.tests))(
      fields.tests ??
        '[{"input":[[1,2,3]],"expected":6},{"input":[[]],"expected":0},{"input":[[-2,1]],"expected":-1}]',
    ).pipe(
      Effect.mapError(() =>
        failure("invalid-input", "Tests need JSON input arrays and expected values."),
      ),
    );
    const examples = fields.exampleTests?.trim()
      ? yield* Schema.decodeUnknown(
          Schema.parseJson(
            Schema.Array(CodingTestSchema).pipe(Schema.minItems(1), Schema.maxItems(20)),
          ),
        )(fields.exampleTests).pipe(
          Effect.mapError(() => failure("invalid-input", "Examples need valid JSON test cases.")),
        )
      : undefined;
    return yield* Schema.decodeUnknown(CodingPayloadSchema)({
      prompts: [fields.prompt ?? ""],
      rubric: fields.rubric ?? "",
      reference: fields.reference ?? "",
      language: fields.language ?? "javascript",
      tests,
      ...(fields.starterCode ? { starterCode: fields.starterCode } : {}),
      ...(fields.signature ? { signature: fields.signature } : {}),
      constraints: (fields.constraints ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      hints: (fields.hints ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      ...(examples ? { exampleTests: examples } : {}),
      mode: fields.mode || "practice",
    }).pipe(
      Effect.mapError(() =>
        failure("invalid-input", "Check coding language, mode, and problem metadata."),
      ),
    );
  });
}
