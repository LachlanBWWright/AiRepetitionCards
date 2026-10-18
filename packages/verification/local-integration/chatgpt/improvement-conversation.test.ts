import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  createLocalTutorApi,
  sendImprovementMessage,
  type KnowledgeNotebook,
  type LocalTutorPorts,
  KnowledgeNotebookSchema,
  resolveNotebookProposal,
} from "@recall/application";
import { createAreaId, createAssessmentId } from "@recall/domain";
import { IMPROVEMENT_CHAT_INSTRUCTIONS } from "@recall/ai-core";
const area = {
  schemaVersion: "1.0.0" as const,
  id: createAreaId("rust"),
  title: "Rust Programming",
  description: null,
  language: "en",
  objectives: [],
  cards: [],
  tags: [],
  licence: null,
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  let n = 0;
  let notebook: KnowledgeNotebook | null = null;
  const entries = new Map<string, string>();
  const prompts: string[] = [];
  const ports: LocalTutorPorts = {
    model: "gpt-6-luna",
    createId: () => uuid(++n),
    assertCurrent: Effect.void,
    failure: (code) => ({ _tag: "TutorApiFailure", reason: "http", code, status: 400 }),
    read: (key) => Effect.succeed(entries.get(key) ?? null),
    write: (values) =>
      Effect.sync(() => {
        for (const [key, value] of values) entries.set(key, value);
      }),
    infer: ({ input, instructions }) => {
      prompts.push(input);
      assert.ok(instructions.includes(IMPROVEMENT_CHAT_INSTRUCTIONS));
      return Effect.succeed(
        JSON.stringify({
          question:
            "Borrow the string with &str so the caller keeps ownership. Here is a card for that.",
          objectiveId: null,
          teachingIntent: "Explain borrowing and propose the requested card.",
          proposal: {
            front: `Which parameter type inspects a Rust String without taking ownership? ${String(n)}`,
            back: "Use &str to borrow its string contents.",
            objectiveId: null,
            rationale: "The learner requested a card, without needing an assessment.",
          },
        }),
      );
    },
  };
  const api = createLocalTutorApi(ports);
  return {
    api,
    prompts,
    saved: () => notebook,
    send: (message: string, previous: KnowledgeNotebook | null = notebook) =>
      sendImprovementMessage(
        { notebook: previous, area, reviews: [], message },
        {
          api,
          save: (next) => {
            notebook = next;
            return Effect.succeed(next);
          },
          now: () => 1000,
          createId: () => uuid(++n),
        },
      ),
  };
}
await test("real local Improve can propose cards on first request and on idk without evaluating the learner", async () => {
  const f = fixture();
  await Effect.runPromise(f.send("i need cards"));
  const result = await Effect.runPromise(f.send("idk, make a card"));
  assert.equal(result.proposals.length, 2);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.session.pendingQuestion, null);
  assert.equal(f.prompts.length, 2);
  const pending = result.proposals[1];
  assert.ok(pending?.providerSessionId);
  const session = await Effect.runPromise(f.api.readSession(pending.providerSessionId));
  assert.equal(session?.evaluation, null);
  assert.equal(session.proposal?.proposalId, pending.id);
  assert.equal(pending.status, "pending");
  assert.ok(Either.isRight(Schema.decodeUnknownEither(KnowledgeNotebookSchema)(result)));
  const invalid = {
    ...result,
    proposals: result.proposals.map((proposal) => ({ ...proposal, chatMessageId: uuid(9999) })),
  };
  assert.ok(Either.isLeft(Schema.decodeUnknownEither(KnowledgeNotebookSchema)(invalid)));
  await Effect.runPromise(
    f.api.resolveProposal({
      proposalId: pending.id,
      state: "approved",
      cardId: createAssessmentId(pending.id),
    }),
  );
  assert.equal(
    (await Effect.runPromise(f.api.readSession(pending.providerSessionId)))?.proposal,
    null,
  );
  const accepted = await Effect.runPromise(
    resolveNotebookProposal(result, {
      id: pending.id,
      status: "accepted",
      cardId: createAssessmentId(pending.id),
    }),
  );
  assert.equal(accepted.proposals[1]?.status, "accepted");
});
await test("a saved diagnostic question becomes conversational history, not an answer gate", async () => {
  const f = fixture();
  const first = await Effect.runPromise(f.send("Help me learn borrowing"));
  const legacy = {
    ...first,
    session: {
      ...first.session,
      pendingQuestion: {
        question: "What is borrowing?",
        teachingIntent: "Probe ownership",
        objectiveId: null,
      },
      targetConceptId: first.concepts[0]?.id ?? null,
    },
  };
  const result = await Effect.runPromise(f.send("I don't know. Make a card.", legacy));
  assert.equal(result.session.pendingQuestion, null);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.proposals.length, 2);
});
