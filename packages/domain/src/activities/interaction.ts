import { Schema } from "effect";
import { ActivityJsonSchema } from "./json";

export const ActivitySeedSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.between(0, Number.MAX_SAFE_INTEGER),
);
export type ActivitySeed = typeof ActivitySeedSchema.Type;
const id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));
const counter = Schema.Number.pipe(Schema.int(), Schema.between(0, 10_000));
export const ActivityInteractionActionSchema = Schema.Struct({
  type: id,
  targetId: Schema.optional(id),
  value: Schema.optional(ActivityJsonSchema),
});
export type ActivityInteractionAction = typeof ActivityInteractionActionSchema.Type;
export const ActivityInteractionSchema = Schema.Struct({
  seed: Schema.optional(ActivitySeedSchema),
  firstTry: Schema.optional(Schema.Boolean),
  hints: Schema.optional(counter),
  retries: Schema.optional(counter),
  actions: Schema.optional(
    Schema.Array(ActivityInteractionActionSchema).pipe(Schema.maxItems(200)),
  ),
}).pipe(Schema.filter((value) => JSON.stringify(value).length <= 100_000));
export type ActivityInteraction = typeof ActivityInteractionSchema.Type;
export const ActivityRuntimeProvenanceSchema = Schema.Struct({
  runtime: id,
  runtimeVersion: id,
  scriptVersion: Schema.optional(id),
  seed: Schema.optional(ActivitySeedSchema),
});
export type ActivityRuntimeProvenance = typeof ActivityRuntimeProvenanceSchema.Type;
