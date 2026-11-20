import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  AGENT_TASKS,
  createAgentHandover,
  parseAgentProposal,
  MAX_AGENT_JSON_BYTES,
} from "@recall/application";
import { workspace, deck, card, proposal } from "./fixtures";

const options = {
  handoverId: "handover-one",
  deckIds: [deck.id],
  task: "improve" as const,
  goal: "Help me understand Rust",
  includeConversation: false,
  includeReviews: false,
  conversation: [{ role: "learner" as const, content: "My private question" }],
};
const run = <A, E>(value: Effect.Effect<A, E>) => Effect.runPromise(Effect.either(value));

await test("every task produces a conversation-first, versioned handover with a proposal schema", async () => {
  for (const task of AGENT_TASKS) {
    const text = await Effect.runPromise(
      createAgentHandover(workspace, { ...options, task: task.value }),
    );
    const parsed = Schema.decodeUnknownSync(
      Schema.parseJson(
        Schema.Struct({
          format: Schema.String,
          version: Schema.Number,
          instructions: Schema.String,
          task: Schema.String,
          responseSchema: Schema.Unknown,
        }),
      ),
    )(text);
    assert.equal(parsed.format, "recall-agent-handover");
    assert.equal(parsed.version, 1);
    assert.equal(parsed.task, task.label);
    assert.match(parsed.instructions, /Converse first/);
    assert.match(parsed.instructions, /prepare changes/);
    assert.ok(parsed.responseSchema);
    assert.ok(!text.includes("My private question"));
    assert.ok(!text.includes("review1"));
    assert.ok(!text.includes('"schedule"'));
  }
});
await test("history is opt-in, bounded, and selected cards constrain exported content and ratings", async () => {
  const conversation = Array.from({ length: 30 }, (_, index) => ({
    role: "learner" as const,
    content: `message ${String(index)}`,
  }));
  const text = await Effect.runPromise(
    createAgentHandover(workspace, {
      ...options,
      includeConversation: true,
      includeReviews: true,
      conversation,
      cardIds: [card.id],
    }),
  );
  assert.ok(text.includes("message 29"));
  assert.ok(!text.includes('"message 0"'));
  assert.ok(text.includes('"again"'));
  assert.ok(!text.includes('"deviceId"'));
  assert.ok(
    Either.isLeft(await run(createAgentHandover(workspace, { ...options, cardIds: ["missing"] }))),
  );
  assert.ok(Either.isLeft(await run(createAgentHandover(workspace, { ...options, deckIds: [] }))));
});
await test("proposal import rejects unsupported fields, oversized data, malformed JSON and versions", async () => {
  const good = JSON.stringify(proposal());
  assert.ok(Either.isRight(await run(parseAgentProposal(good))));
  assert.ok(
    Either.isRight(
      await run(parseAgentProposal(`\u0060\u0060\u0060json\n${good}\n\u0060\u0060\u0060`)),
    ),
  );
  for (const text of [
    "not JSON",
    JSON.stringify({ ...proposal(), version: 2 }),
    JSON.stringify({ ...proposal(), schedule: {} }),
    JSON.stringify({ ...proposal(), operations: [{ ...proposal().operations[0], schedule: {} }] }),
    "x".repeat(MAX_AGENT_JSON_BYTES + 1),
    JSON.stringify({
      ...proposal(),
      operations: Array.from({ length: 101 }, () => proposal().operations[0]),
    }),
  ])
    assert.ok(Either.isLeft(await run(parseAgentProposal(text))));
});
