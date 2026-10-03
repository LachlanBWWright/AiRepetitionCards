import { Schema } from "effect";

/** Validate calendar fields before parsing: Date.parse alone normalizes impossible dates. */
export function normalizeReviewTimestamp(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(input);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  const zone = parts[7];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (
    year < 1 ||
    days === undefined ||
    day < 1 ||
    day > days ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    zone === undefined
  )
    return null;
  if (zone !== "Z") {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0))
      return null;
  }
  const time = Date.parse(input);
  if (!Number.isFinite(time)) return null;
  const normalized = new Date(time).toISOString();
  return /^\d{4}-/.test(normalized) && !normalized.startsWith("0000-") ? normalized : null;
}
export const ReviewTimestampSchema = Schema.String.pipe(
  Schema.filter((value) => normalizeReviewTimestamp(value) !== null, {
    message: () => "Expected a valid calendar timestamp with an explicit time zone.",
  }),
);
