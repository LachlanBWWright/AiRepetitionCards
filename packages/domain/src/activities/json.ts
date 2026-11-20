import { Schema } from "effect";

/** A bounded JSON payload, never executable plugin code. Plugins validate its specific shape. */
export type ActivityJson =
  | null
  | string
  | number
  | boolean
  | readonly ActivityJson[]
  | { readonly [key: string]: ActivityJson };
/** Validate iteratively before schema traversal so deeply nested or cyclic input cannot exhaust the stack. */
export function isBoundedActivityJson(input: unknown): input is ActivityJson {
  const pending: { readonly value: unknown; readonly depth: number; readonly exit?: boolean }[] = [
    { value: input, depth: 0 },
  ];
  const ancestors = new WeakSet();
  let visited = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) return false;
    const { value, depth } = entry;
    if (entry.exit && typeof value === "object" && value !== null) {
      ancestors.delete(value);
      continue;
    }
    visited += 1;
    if (depth > 32 || visited > 50_000) return false;
    if (typeof value === "string") {
      if (value.length > 100_000) return false;
      continue;
    }
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "object" || ancestors.has(value)) return false;
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    ancestors.add(value);
    pending.push({ value, depth, exit: true });
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key.length > 100_000) return false;
      if (Array.isArray(value) && key === "length") continue;
      if (!("value" in descriptor) || !descriptor.enumerable) return false;
      if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) return false;
      pending.push({ value: descriptor.value, depth: depth + 1 });
      if (pending.length > 100_000) return false;
    }
    if (Array.isArray(value) && Object.keys(descriptors).length !== value.length + 1) return false;
  }
  return true;
}
export const ActivityJsonSchema: Schema.Schema<ActivityJson> = Schema.declare(
  isBoundedActivityJson,
).annotations({
  jsonSchema: {
    type: ["null", "string", "number", "boolean", "array", "object"],
    description:
      "JSON value; runtime validation additionally enforces depth <= 32, <= 50000 visited values, and finite numbers.",
  },
});
/** Validate the whole object before walking its fields, including cycles and accessors. */
export const ActivityJsonObjectSchema: Schema.Schema<Readonly<Record<string, ActivityJson>>> =
  Schema.declare(
    (input: unknown): input is Readonly<Record<string, ActivityJson>> =>
      isBoundedActivityJson(input) &&
      input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      JSON.stringify(input).length <= 100_000,
  ).annotations({ jsonSchema: { type: "object", additionalProperties: true } });
