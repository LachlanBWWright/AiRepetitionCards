import { Schema } from "effect";

const id = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(200),
  Schema.filter((s) => s.trim().length > 0),
);
const text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000));
export const ActivityShuffleSeedSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.between(0, 4_294_967_295),
);
export type ActivityShuffleSeed = typeof ActivityShuffleSeedSchema.Type;
const explanation = Schema.String.pipe(Schema.maxLength(20_000));
const item = Schema.Struct({ id, text });
export const OrderingPayloadSchema = Schema.Struct({
  seed: Schema.optional(ActivityShuffleSeedSchema),
  prompt: text,
  items: Schema.Array(item).pipe(
    Schema.minItems(2),
    Schema.maxItems(20),
    Schema.filter((items) => new Set(items.map((item) => item.id)).size === items.length),
  ),
  explanation,
});
export type OrderingPayload = typeof OrderingPayloadSchema.Type;
export const MatchingPayloadSchema = Schema.Struct({
  seed: Schema.optional(ActivityShuffleSeedSchema),
  prompt: text,
  pairs: Schema.Array(Schema.Struct({ id, left: text, right: text })).pipe(
    Schema.minItems(2),
    Schema.maxItems(20),
    Schema.filter((pairs) => new Set(pairs.map((pair) => pair.id)).size === pairs.length),
  ),
  explanation,
});
export type MatchingPayload = typeof MatchingPayloadSchema.Type;
export const CodeTracingPayloadSchema = Schema.Struct({
  prompt: text,
  code: text,
  language: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  expectedOutput: Schema.String.pipe(Schema.maxLength(20_000)),
  explanation,
});
export type CodeTracingPayload = typeof CodeTracingPayloadSchema.Type;
