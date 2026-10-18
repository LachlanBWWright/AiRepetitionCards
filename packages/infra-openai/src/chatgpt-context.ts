import { Effect, Either, Schema } from "effect";
import { TUTOR_CONTEXT_TOKEN_LIMIT, TutorTokenUsageSchema } from "@recall/ai-core";

const Count = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.filter(Number.isSafeInteger),
);
const TokenCount = Schema.Struct({ input_tokens: Count });
const Usage = Schema.Struct({
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.optional(Count),
      output_tokens: Schema.optional(Count),
      input_tokens_details: Schema.optional(
        Schema.Struct({
          cached_tokens: Schema.optional(Count),
          cache_write_tokens: Schema.optional(Count),
        }),
      ),
    }),
  ),
});

/** One count at send time; no inference, draft polling, or credential access in this module. */
export function enforceChatGPTContextLimit(request: () => Promise<Response>) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: request,
      catch: () => "context-count-unavailable",
    });
    if (!response.ok) return yield* Effect.fail("context-count-unavailable");
    const raw: unknown = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => "context-count-unavailable",
    });
    const decoded = Schema.decodeUnknownEither(TokenCount)(raw);
    if (Either.isLeft(decoded)) return yield* Effect.fail("context-count-unavailable");
    if (decoded.right.input_tokens > TUTOR_CONTEXT_TOKEN_LIMIT)
      return yield* Effect.fail("context-limit-exceeded");
    return decoded.right.input_tokens;
  });
}

export function readChatGPTTokenUsage(
  response: unknown,
  model: string,
  countedInputTokens: number,
) {
  const decoded = Schema.decodeUnknownEither(Usage)(response);
  const usage = Either.isRight(decoded) ? decoded.right.usage : undefined;
  const next = {
    model,
    inputTokens: usage?.input_tokens ?? countedInputTokens,
    outputTokens: usage?.output_tokens ?? null,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? null,
    cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens ?? null,
  };
  const valid = Schema.decodeUnknownEither(TutorTokenUsageSchema)(next);
  return Either.isRight(valid)
    ? valid.right
    : {
        model,
        inputTokens: countedInputTokens,
        outputTokens: null,
        cachedInputTokens: null,
        cacheWriteTokens: null,
      };
}

export function readChatGPTUsageCounts(response: unknown): {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
} {
  const decoded = Schema.decodeUnknownEither(Usage)(response);
  const usage = Either.isRight(decoded) ? decoded.right.usage : undefined;
  return { inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null };
}
