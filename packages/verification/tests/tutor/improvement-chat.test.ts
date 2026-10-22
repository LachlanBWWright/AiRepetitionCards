import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import type { TutorActionRequest, TutorActionResponse } from "@recall/ai-core";
import {
  createTutorApi,
  improvementMessages,
  improvementOpening,
  sendImprovementMessage,
  type KnowledgeNotebook,
  type TutorApiFailure,
} from "@recall/application";
import { knowledgeArea, uuid } from "../fixtures/search-workspace";
function harness() {
  let saved: KnowledgeNotebook | null = null;
  let sequence = 100;
  const requests: TutorActionRequest[] = [];
  const api: ReturnType<typeof createTutorApi> = {
    ...createTutorApi(() => Effect.succeed({ status: 503, body: null })),
    request: (input): Effect.Effect<TutorActionResponse, TutorApiFailure> => {
      requests.push(input);
      if (input.action !== "question")
        return Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" });
      return Effect.succeed({
        action: "question",
        sessionId: uuid(++sequence),
        proposalId: uuid(++sequence),
        providerResolutionRequired: false,
        result: {
          question:
            "You can use a channel to communicate between goroutines. Here is a card to review.",
          teachingIntent: "Explain and propose the requested card without assessing the learner.",
          objectiveId: knowledgeArea().objectives[0]?.id ?? null,
          proposal: {
            front: `How do channels coordinate goroutines? ${String(sequence)}`,
            back: "They pass values between goroutines.",
            objectiveId: knowledgeArea().objectives[0]?.id ?? null,
            rationale: "Requested by the learner.",
          },
        },
      });
    },
  };
  const dependencies = {
    api,
    save: (next: KnowledgeNotebook) => {
      saved = next;
      return Effect.succeed(next);
    },
    now: () => 1000,
    createId: () => uuid(++sequence),
  };
  return {
    dependencies,
    requests,
    saved: () => saved,
    send: (message: string) =>
      sendImprovementMessage(
        { notebook: saved, area: knowledgeArea(), reviews: [], message },
        dependencies,
      ),
  };
}
void test("a first-message card request produces an unapproved proposal without a quiz or evaluation", async () => {
  const f = harness();
  const result = await Effect.runPromise(f.send("I need cards"));
  assert.deepEqual(
    f.requests.map((request) => request.action),
    ["question"],
  );
  const request = f.requests[0];
  assert.ok(request?.action === "question");
  assert.deepEqual(request.context.improvement, {
    goal: `Explore experience and gaps in ${knowledgeArea().title}\nRecent self-rated reviews: none`,
  });
  assert.deepEqual(request.context.history, [
    { role: "assistant", content: improvementOpening(knowledgeArea()) },
    { role: "learner", content: "I need cards" },
  ]);
  assert.equal(request.context.history.at(-1)?.content, "I need cards");
  assert.equal(result.session.pendingQuestion, null);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.proposals[0]?.status, "pending");
  assert.equal(result.proposals[0].cardId, null);
  assert.equal(result.proposals[0].providerResolutionRequired, false);
  assert.deepEqual(result.proposals[0].evidenceIds, []);
});
void test("I don't know and make a card stay conversational and never become graded answers", async () => {
  const f = harness();
  await Effect.runPromise(f.send("Help me understand channels"));
  const result = await Effect.runPromise(f.send("idk, make a card"));
  assert.deepEqual(
    f.requests.map((request) => request.action),
    ["question", "question"],
  );
  const request = f.requests[1];
  assert.ok(request?.action === "question");
  assert.equal(request.context.history.at(-1)?.content, "idk, make a card");
  assert.equal(request.context.history.length, 4);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.proposals.length, 2);
  assert.ok(result.proposals.every((proposal) => proposal.status === "pending"));
  assert.equal(result.session.pendingQuestion, null);
  assert.equal(improvementMessages(result).length, 5);
});
void test("a failed AI request keeps the sent message and retry does not duplicate it", async () => {
  const f = harness();
  const dependencies = {
    ...f.dependencies,
    api: createTutorApi(() => Effect.fail({ _tag: "TutorTransportError" })),
  };
  const input = () => ({
    notebook: f.saved(),
    area: knowledgeArea(),
    reviews: [],
    message: "Help me find gaps",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(Effect.either(sendImprovementMessage(input(), dependencies))),
      ),
    );
    assert.deepEqual(
      improvementMessages(f.saved()).map(({ role, content }) => ({ role, content })),
      [
        { role: "assistant", content: improvementOpening(knowledgeArea()) },
        { role: "learner", content: "Help me find gaps" },
      ],
    );
  }
  const result = await Effect.runPromise(f.send("Help me find gaps"));
  assert.equal(improvementMessages(result).length, 3);
  assert.equal(
    improvementMessages(result).filter((message) => message.role === "learner").length,
    1,
  );
  assert.equal(result.evidence.length, 0);
});
