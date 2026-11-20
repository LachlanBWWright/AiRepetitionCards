import { Schema } from "effect";
import { ActivityJsonSchema } from "./json";

const text = Schema.String.pipe(Schema.maxLength(20_000));
export const CodingLanguageSchema = Schema.Literal("javascript", "python", "rust");
export type CodingLanguage = typeof CodingLanguageSchema.Type;
export const CodingTestSchema = Schema.Struct({
  input: Schema.Array(ActivityJsonSchema).pipe(Schema.maxItems(10)),
  expected: ActivityJsonSchema,
}).pipe(Schema.filter((value) => JSON.stringify(value).length <= 100_000));
export type CodingTest = typeof CodingTestSchema.Type;
export const CodingPayloadSchema = Schema.Struct({
  prompts: Schema.Array(text.pipe(Schema.minLength(1))).pipe(
    Schema.minItems(1),
    Schema.maxItems(10),
  ),
  rubric: text.pipe(Schema.minLength(1)),
  reference: text,
  language: CodingLanguageSchema,
  tests: Schema.Array(CodingTestSchema).pipe(Schema.minItems(1), Schema.maxItems(20)),
  starterCode: Schema.optional(text),
  signature: Schema.optional(text),
  constraints: Schema.optional(Schema.Array(text).pipe(Schema.maxItems(20))),
  hints: Schema.optional(Schema.Array(text).pipe(Schema.maxItems(20))),
  exampleTests: Schema.optional(Schema.Array(CodingTestSchema).pipe(Schema.maxItems(20))),
  mode: Schema.optional(Schema.Literal("short-review", "practice")),
});
export type CodingPayload = typeof CodingPayloadSchema.Type;
export const CodingExecutionSchema = Schema.Struct({
  passed: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  total: Schema.Number.pipe(Schema.int(), Schema.between(1, 20)),
  failures: Schema.Array(Schema.String.pipe(Schema.maxLength(2000))).pipe(Schema.maxItems(20)),
  status: Schema.optional(Schema.Literal("passed", "failed", "timeout", "error")),
  diagnostics: Schema.optional(
    Schema.Array(Schema.String.pipe(Schema.maxLength(2000))).pipe(Schema.maxItems(20)),
  ),
  stdout: Schema.optional(Schema.String.pipe(Schema.maxLength(20_000))),
  runtimeMs: Schema.optional(Schema.Number.pipe(Schema.finite(), Schema.between(0, 3_600_000))),
}).pipe(Schema.filter((value) => value.passed <= value.total));
export type CodingExecution = typeof CodingExecutionSchema.Type;
