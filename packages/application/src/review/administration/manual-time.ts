import { normalizeReviewTimestamp } from "@recall/contracts";
export function normalizeManualDue(input: unknown): string | null {
  return typeof input === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(input)
    ? normalizeReviewTimestamp(input)
    : null;
}
