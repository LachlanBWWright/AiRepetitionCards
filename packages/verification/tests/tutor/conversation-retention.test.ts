import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createTutorConversationStore, type ConversationRecordPort } from "@recall/application";

function fixture() {
  let raw: string | null = null;
  const port: ConversationRecordPort = {
    read: Effect.sync(() => raw),
    commit: (expected, next) =>
      Effect.suspend(() => {
        if (raw !== expected) return Effect.fail({ message: "stale" });
        raw = next;
        return Effect.void;
      }),
  };
  return {
    port,
    value: () => raw,
    corrupt: (value: string) => {
      raw = value;
    },
  };
}
await test("conversation storage resumes by scoped subject and supports explicit erasure", () => {
  const f = fixture();
  const store = createTutorConversationStore("owner:provider", "subject", f.port);
  assert.equal(Effect.runSync(store.read), null);
  assert.equal(f.value(), null);
  const history = [
    { role: "learner", content: "Explain ATP" },
    { role: "assistant", content: "It transfers energy." },
  ] as const;
  Effect.runSync(store.write(history, "A follow-up"));
  const reopened = createTutorConversationStore("owner:provider", "subject", f.port);
  assert.deepEqual(Effect.runSync(reopened.read)?.history, history);
  assert.equal(Effect.runSync(reopened.read)?.draft, "A follow-up");
  const foreign = createTutorConversationStore("different-owner", "subject", f.port);
  assert.ok(Either.isLeft(Effect.runSync(Effect.either(foreign.read))));
  assert.notEqual(f.value(), null);
  Effect.runSync(reopened.clear);
  assert.equal(f.value(), null);
});
await test("a concurrent view cannot overwrite or delete a newer saved conversation", () => {
  const f = fixture();
  const first = createTutorConversationStore("owner", "subject", f.port);
  const second = createTutorConversationStore("owner", "subject", f.port);
  Effect.runSync(first.read);
  Effect.runSync(second.read);
  Effect.runSync(first.write([{ role: "learner", content: "First" }], ""));
  assert.ok(Either.isLeft(Effect.runSync(Effect.either(second.write([], "stale")))));
  assert.ok(Either.isLeft(Effect.runSync(Effect.either(second.clear))));
  assert.equal(Effect.runSync(first.read)?.history[0]?.content, "First");
});
await test("corrupt conversations are preserved until explicit deletion; writes are bounded", () => {
  const f = fixture();
  f.corrupt("not-json");
  const store = createTutorConversationStore("owner", "subject", f.port);
  assert.ok(Either.isLeft(Effect.runSync(Effect.either(store.read))));
  assert.ok(Either.isLeft(Effect.runSync(Effect.either(store.write([], "")))));
  assert.equal(f.value(), "not-json");
  Effect.runSync(store.clear);
  assert.equal(f.value(), null);
  assert.ok(Either.isLeft(Effect.runSync(Effect.either(store.write([], "x".repeat(2001))))));
  Effect.runSync(
    store.write(
      Array.from({ length: 120 }, (_, i) => ({ role: "learner" as const, content: String(i) })),
      "",
    ),
  );
  const saved = Effect.runSync(store.read);
  assert.equal(saved?.history.length, 100);
  assert.equal(saved.history[0]?.content, "20");
});
