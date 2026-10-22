import { Schema } from "effect";

export const ReviewerActionSchema = Schema.Literal("reveal", "again", "hard", "good", "easy");
export type ReviewerAction = typeof ReviewerActionSchema.Type;
const ShortcutSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(1),
  Schema.pattern(/^[a-z0-9 ]$/i),
);
export const ReviewerSettingsSchema = Schema.Struct({
  showTimer: Schema.Boolean,
  questionSeconds: Schema.Number.pipe(Schema.int(), Schema.between(0, 600)),
  answerSeconds: Schema.Number.pipe(Schema.int(), Schema.between(0, 600)),
  answerAction: Schema.Literal("again", "hard", "good", "easy"),
  shortcuts: Schema.Struct({
    reveal: ShortcutSchema,
    again: ShortcutSchema,
    hard: ShortcutSchema,
    good: ShortcutSchema,
    easy: ShortcutSchema,
  }).pipe(
    Schema.filter(
      (keys) => new Set(Object.values(keys).map((key) => key.toLowerCase())).size === 5,
    ),
  ),
  swipeEnabled: Schema.Boolean,
  swipeLeft: ReviewerActionSchema,
  swipeRight: ReviewerActionSchema,
});
export type ReviewerSettings = typeof ReviewerSettingsSchema.Type;
export const defaultReviewerSettings: ReviewerSettings = {
  showTimer: false,
  questionSeconds: 0,
  answerSeconds: 0,
  answerAction: "again",
  shortcuts: { reveal: " ", again: "1", hard: "2", good: "3", easy: "4" },
  swipeEnabled: false,
  swipeLeft: "again",
  swipeRight: "good",
};
