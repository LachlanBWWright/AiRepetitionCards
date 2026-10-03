import { sha256 } from "@noble/hashes/sha2.js";
import { Effect, Schema } from "effect";
import { StudyCardSchema } from "@recall/domain";

export const REVIEW_SCHEDULE_HASH_VERSION = "recall-fsrs-schedule-v1";
export type ReviewScheduleHashInvalid = { readonly _tag: "ReviewScheduleHashInvalid" };

function utcTimestamp(value: string): string | null {
  // Require an explicit zone so local device time zones cannot change the digest.
  if (!value.includes("T") || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/** Pure versioned SHA-256 over explicit FSRS fields, canonical UTC dates and null absence. */
export function reviewScheduleHash(
  input: unknown,
): Effect.Effect<string, ReviewScheduleHashInvalid> {
  return Effect.gen(function* () {
    const schedule = yield* Schema.decodeUnknown(StudyCardSchema.fields.schedule)(input).pipe(
      Effect.mapError(() => ({ _tag: "ReviewScheduleHashInvalid" }) as const),
    );
    const due = utcTimestamp(schedule.due);
    const lastReview = schedule.last_review == null ? null : utcTimestamp(schedule.last_review);
    if (
      due === null ||
      (schedule.last_review != null && lastReview === null) ||
      ![
        schedule.stability,
        schedule.difficulty,
        schedule.elapsed_days,
        schedule.scheduled_days,
        schedule.learning_steps,
        schedule.reps,
        schedule.lapses,
      ].every(Number.isFinite)
    )
      return yield* Effect.fail({ _tag: "ReviewScheduleHashInvalid" } as const);
    // Ordered tuple fixes encoding independently of object property/insertion order.
    const canonical = JSON.stringify([
      REVIEW_SCHEDULE_HASH_VERSION,
      due,
      schedule.stability,
      schedule.difficulty,
      schedule.elapsed_days,
      schedule.scheduled_days,
      schedule.learning_steps,
      schedule.reps,
      schedule.lapses,
      schedule.state,
      lastReview,
    ]);
    // This canonical JSON is ASCII: dates, numeric fields and the fixed version marker.
    const bytes = Uint8Array.from(canonical, (character) => character.charCodeAt(0));
    return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}
