import { Effect } from "effect";
import type { Json } from "./database.types";

export type DatabaseJsonEncodeError = { readonly _tag: "DatabaseJsonEncodeError" };

type JsonResult = { readonly _tag: "Encoded"; readonly value: Json } | { readonly _tag: "Invalid" };

function encode(value: unknown, ancestors: WeakSet<object>): JsonResult {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { _tag: "Encoded", value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { _tag: "Encoded", value } : { _tag: "Invalid" };
  }
  if (typeof value !== "object") return { _tag: "Invalid" };
  if (ancestors.has(value)) return { _tag: "Invalid" };
  ancestors.add(value);

  if (Array.isArray(value)) {
    const children: readonly unknown[] = value;
    const output: Json[] = [];
    for (const child of children) {
      if (child === undefined) return { _tag: "Invalid" };
      const encoded = encode(child, ancestors);
      if (encoded._tag === "Invalid") return encoded;
      output.push(encoded.value);
    }
    ancestors.delete(value);
    return { _tag: "Encoded", value: output };
  }

  const output: { [key: string]: Json | undefined } = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const encoded = encode(child, ancestors);
    if (encoded._tag === "Invalid") return encoded;
    output[key] = encoded.value;
  }
  ancestors.delete(value);
  return { _tag: "Encoded", value: output };
}

/** Clone schema-validated values to the mutable JSON shape expected by Supabase's generated types. */
export function toDatabaseJson(value: unknown): Effect.Effect<Json, DatabaseJsonEncodeError> {
  const result = encode(value, new WeakSet());
  return result._tag === "Encoded"
    ? Effect.succeed(result.value)
    : Effect.fail({ _tag: "DatabaseJsonEncodeError" });
}
