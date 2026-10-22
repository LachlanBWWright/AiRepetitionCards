import { Schema } from "effect";

export const TypedAnswerSettingsSchema = Schema.Struct({
  enabled: Schema.Boolean,
  ignoreCase: Schema.Boolean,
  ignoreAccents: Schema.Boolean,
});
export const SpeechFieldSettingsSchema = Schema.Struct({
  language: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  voice: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  rate: Schema.Number.pipe(Schema.between(0.25, 2)),
  autoplay: Schema.Boolean,
});
export const CardAppearanceSchema = Schema.Struct({
  font: Schema.Literal("sans", "serif", "mono"),
  size: Schema.Literal("small", "medium", "large"),
  align: Schema.Literal("left", "center"),
  lineSpacing: Schema.Literal("compact", "comfortable"),
});
export type CardAppearance = typeof CardAppearanceSchema.Type;
export const ReviewPresentationSchema = Schema.Struct({
  appearance: Schema.optional(CardAppearanceSchema),
  typedAnswer: Schema.optional(TypedAnswerSettingsSchema),
  speech: Schema.optional(
    Schema.Struct({
      front: Schema.optional(SpeechFieldSettingsSchema),
      back: Schema.optional(SpeechFieldSettingsSchema),
    }),
  ),
});
export type ReviewPresentation = typeof ReviewPresentationSchema.Type;
export type SpeechFieldSettings = typeof SpeechFieldSettingsSchema.Type;
export type TypedAnswerSettings = typeof TypedAnswerSettingsSchema.Type;
