import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { reserveLocalAiUsage, summarizeLocalAiUsage } from "@recall/application";
import { createLocalAiUsageStore } from "../../../../apps/desktop/src/main/chatgpt/usage/local-ai-usage.js";

await test("legacy request caps cannot block ChatGPT and reported token history is preserved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recall-chatgpt-usage-"));
  try {
    const path = join(directory, "usage.json");
    const startedAt = Date.UTC(2026, 9, 16, 12);
    const entry = {
      requestId: "previous",
      accountId: "client",
      model: "study",
      task: "tutor",
      startedAt,
      finishedAt: startedAt + 1,
      outcome: "completed",
      inputTokens: 1234,
      outputTokens: 567,
    };
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        policies: [
          {
            accountId: "client",
            dailyRequestLimit: 0,
            weeklyRequestLimit: 0,
            dailyResearchLimit: 0,
          },
        ],
        entries: [entry],
      }),
    );
    const store = createLocalAiUsageStore(path);
    const state = await Effect.runPromise(store.read());
    assert.deepEqual(state.entries, [entry]);
    assert.deepEqual(state.policies, []);
    const admitted = await Effect.runPromise(
      reserveLocalAiUsage(state, {
        requestId: "next",
        accountId: "client",
        model: "study",
        task: "research",
        startedAt: startedAt + 2,
      }),
    );
    await Effect.runPromise(store.write(admitted.state));
    const restored = await Effect.runPromise(store.read());
    assert.equal(restored.entries.length, 2);
    const summary = await Effect.runPromise(
      summarizeLocalAiUsage(restored, "client", startedAt + 3),
    );
    assert.equal(summary.daily.inputTokens, 1234);
    assert.equal(summary.daily.outputTokens, 567);
    assert.equal(summary.daily.unknownUsageRequests, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("invalid token history is preserved and fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recall-chatgpt-usage-"));
  try {
    const path = join(directory, "usage.json");
    await writeFile(path, "invalid history");
    const result = await Effect.runPromise(Effect.either(createLocalAiUsageStore(path).read()));
    assert.equal(Either.isLeft(result), true);
    assert.equal(await readFile(path, "utf8"), "invalid history");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
