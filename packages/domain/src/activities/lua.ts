import { Schema } from "effect";
import { ActivityJsonObjectSchema } from "./json";
import { ActivitySeedSchema } from "./interaction";

export const LuaActivityPayloadSchema = Schema.Struct({
  script: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32_768)),
  configuration: ActivityJsonObjectSchema,
  seed: Schema.optional(ActivitySeedSchema),
});
export type LuaActivityPayload = typeof LuaActivityPayloadSchema.Type;
