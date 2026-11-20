import { Schema } from "effect";

/** Shared context-meter reference; ChatGPT plan admission uses the provider model limit. */
export const TUTOR_CONTEXT_TOKEN_LIMIT = 100_000;
export const MAX_CHAT_TRANSPORT_BYTES = 1_600_000;
export const MAX_CHAT_CONTEXT_MESSAGES = 1000;
const Count = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.filter(Number.isSafeInteger),
);
export const TutorTokenUsageSchema = Schema.Struct({
  model: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  inputTokens: Schema.NullOr(Count),
  outputTokens: Schema.NullOr(Count),
  cachedInputTokens: Schema.NullOr(Count),
  cacheWriteTokens: Schema.NullOr(Count),
}).pipe(
  Schema.filter(
    (usage) =>
      usage.inputTokens === null ||
      (usage.cachedInputTokens ?? 0) + (usage.cacheWriteTokens ?? 0) <= usage.inputTokens,
  ),
);
export type TutorTokenUsage = typeof TutorTokenUsageSchema.Type;
export const TutorInferenceReplySchema = Schema.Struct({
  text: Schema.String,
  usage: TutorTokenUsageSchema,
});
export type TutorInferenceReply = typeof TutorInferenceReplySchema.Type;
