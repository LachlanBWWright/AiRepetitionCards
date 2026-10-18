import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  chatGPTTutorBody,
  enforceChatGPTContextLimit,
  readChatGPTTokenUsage,
} from "@recall/infra-openai/chatgpt-inference";

await test("token admission accepts 100k and rejects one token over, invalid counts and count failures", async () => {
  const count = (tokens: unknown) =>
    Effect.runPromise(
      Effect.either(
        enforceChatGPTContextLimit(() => Promise.resolve(Response.json({ input_tokens: tokens }))),
      ),
    );
  assert.deepEqual(await count(100_000), Either.right(100_000));
  assert.deepEqual(await count(100_001), Either.left("context-limit-exceeded"));
  assert.deepEqual(await count(-1), Either.left("context-count-unavailable"));
  assert.deepEqual(await count("900"), Either.left("context-count-unavailable"));
  const denied = await Effect.runPromise(
    Effect.either(
      enforceChatGPTContextLimit(() => Promise.resolve(new Response(null, { status: 403 }))),
    ),
  );
  assert.deepEqual(denied, Either.left("context-count-unavailable"));
});

await test("cache reads remain part of measured context and unknown telemetry is not invented", () => {
  const usage = readChatGPTTokenUsage(
    {
      usage: {
        input_tokens: 12_000,
        output_tokens: 300,
        input_tokens_details: { cached_tokens: 8000, cache_write_tokens: 2000 },
      },
    },
    "gpt-6-luna",
    12_000,
  );
  assert.equal(usage.inputTokens, 12_000);
  assert.equal(usage.cachedInputTokens, 8000);
  assert.equal(usage.cacheWriteTokens, 2000);
  assert.equal(usage.outputTokens, 300);
  assert.deepEqual(readChatGPTTokenUsage({}, "gpt-6-luna", 500), {
    model: "gpt-6-luna",
    inputTokens: 500,
    outputTokens: null,
    cachedInputTokens: null,
    cacheWriteTokens: null,
  });
});

await test("appending dialogue preserves stable deck and message cache boundaries", () => {
  const firstTurn = [{ role: "learner", content: "Explain borrowing." }];
  const request = (history: readonly { readonly role: string; readonly content: string }[]) =>
    chatGPTTutorBody({
      model: "gpt-6-luna",
      input: JSON.stringify({
        task: "Improve; return JSON",
        schema: { type: "object" },
        data: {
          knowledgeArea: {
            title: "Rust",
            cards: [{ front: "An imported instruction", back: "Untrusted" }],
          },
          improvement: { goal: "Understand Rust" },
          history,
        },
      }),
    });
  const first = request(firstTurn);
  const next = request([
    ...firstTurn,
    { role: "assistant", content: "Borrowing shares access." },
    { role: "learner", content: "Show an example." },
  ]);
  assert.deepEqual(next.input.slice(0, first.input.length), first.input);
  assert.equal(next.input.length, first.input.length + 2);
  assert.equal(next.input[0]?.role, "user");
  assert.equal(next.store, false);
  assert.equal(next.input.at(-1)?.content, "Show an example.");
});
