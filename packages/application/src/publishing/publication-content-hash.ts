import { sha256 } from "@noble/hashes/sha2.js";
import type { KnowledgeArea } from "@recall/domain";

/** Existing publication byte protocol; preserve key ordering and optional-value representation. */
export function canonicalPublicationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPublicationJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalPublicationJson(entry)}`)
      .join(",")}}`;
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol")
    return "null";
  return JSON.stringify(value);
}

/** Hash validated portable content, identically on clients and the publication server. */
export function publicationContentHash(content: KnowledgeArea): string {
  return Array.from(sha256(new TextEncoder().encode(canonicalPublicationJson(content))), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
