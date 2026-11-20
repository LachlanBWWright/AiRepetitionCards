import { Effect, Schema } from "effect";
import {
  ActivityJsonSchema,
  ActivitySeedSchema,
  LuaActivityPayloadSchema,
  isBoundedActivityJson,
  type ActivityJson,
} from "@recall/domain";
import { failure, type ActivityFailure } from "../learning-activities-plugins";

const shortText = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4000));
export const LuaPayloadSchema = LuaActivityPayloadSchema;
export type LuaPayload = typeof LuaPayloadSchema.Type;
export const LuaEventSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  value: Schema.optional(Schema.String.pipe(Schema.maxLength(2000))),
});
export type LuaEvent = typeof LuaEventSchema.Type;
export const LuaViewSchema = Schema.Struct({
  text: shortText,
  buttons: Schema.Array(Schema.Struct({ id: LuaEventSchema.fields.id, label: shortText })).pipe(
    Schema.maxItems(20),
  ),
}).pipe(
  Schema.filter(
    (view) => new Set(view.buttons.map((button) => button.id)).size === view.buttons.length,
  ),
);
export type LuaView = typeof LuaViewSchema.Type;
export const LuaAssessmentSchema = Schema.Struct({
  complete: Schema.Boolean,
  score: Schema.Number.pipe(Schema.finite(), Schema.between(0, 1)),
  feedback: shortText,
});
export const LuaDraftSchema = Schema.Struct({
  version: Schema.Literal(1),
  runtimeVersion: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  seed: ActivitySeedSchema,
  state: ActivityJsonSchema,
  events: Schema.Array(LuaEventSchema).pipe(Schema.maxItems(100)),
});
export type LuaDraft = typeof LuaDraftSchema.Type;
/** Inject an isolated executor. No storage, scheduling, DOM, or other host capabilities. */
export type LuaRuntime = {
  readonly version: string;
  readonly invoke: (request: {
    readonly script: string;
    readonly configuration: Readonly<Record<string, ActivityJson>>;
    readonly seed: number;
    readonly operation: "init" | "view" | "update" | "assess";
    readonly state?: ActivityJson | undefined;
    readonly event?: LuaEvent | undefined;
  }) => Effect.Effect<unknown, ActivityFailure>;
};
export function decodeLua<A, I>(schema: Schema.Schema<A, I>, input: unknown) {
  if (!isBoundedActivityJson(input) || JSON.stringify(input).length > 32_000)
    return Effect.fail(failure("invalid-input", "Lua output exceeds the bounded JSON contract."));
  return Schema.decodeUnknown(schema)(input).pipe(
    Effect.mapError(() => failure("invalid-input", "Lua data does not match the host contract.")),
  );
}
export function decodeLuaPayload(input: unknown) {
  return Schema.decodeUnknown(LuaPayloadSchema)(input).pipe(
    Effect.mapError(() =>
      failure("invalid-input", "Provide a Lua script and bounded JSON configuration."),
    ),
    Effect.filterOrFail(
      (payload) => JSON.stringify(payload.configuration).length <= 16_000,
      () => failure("invalid-input", "Lua configuration exceeds 16,000 characters."),
    ),
  );
}
export const unavailableLuaRuntime: LuaRuntime = {
  version: "unavailable",
  invoke: () =>
    Effect.fail(
      failure(
        "unsupported",
        "Lua execution is unavailable on this platform. Your draft is preserved; use the fallback activity.",
      ),
    ),
};

export const LuaInvocationSchema = Schema.Struct({
  script: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32768)),
  configuration: Schema.Record({ key: Schema.String, value: ActivityJsonSchema }),
  seed: Schema.Number.pipe(Schema.int(), Schema.between(0, 4294967295)),
  operation: Schema.Literal("init", "view", "update", "assess"),
  state: Schema.optional(ActivityJsonSchema),
  event: Schema.optional(LuaEventSchema),
});

export function decodeLuaView(input: unknown) {
  const normalized =
    typeof input === "object" &&
    input !== null &&
    "buttons" in input &&
    typeof input.buttons === "object" &&
    input.buttons !== null &&
    !Array.isArray(input.buttons) &&
    Object.keys(input.buttons).length === 0
      ? { ...input, buttons: [] }
      : input;
  return decodeLua(LuaViewSchema, normalized);
}
