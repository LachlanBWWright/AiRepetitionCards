import { sha256 } from "@noble/hashes/sha2.js";
import type { TutorContext } from "@recall/ai-core";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return value === undefined ? "null" : JSON.stringify(value);
}

/** Bind a compact transport projection to the full owner-synchronized canonical document. */
export function tutorAreaFingerprint(area: TutorContext["knowledgeArea"]): string {
  return Array.from(sha256(new TextEncoder().encode(canonical(area))), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
