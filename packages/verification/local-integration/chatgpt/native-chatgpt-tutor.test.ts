import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { createLocalTutorApi, type LocalTutorPorts } from "@recall/application";
import { createAreaId, type KnowledgeArea } from "@recall/domain";
import {
  createNativeChatGPTPlanClient,
  nativePlanFailure,
} from "../../../../apps/mobile/src/storage/ai/chatgpt-plan-client.js";

const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: createAreaId("cells"),
  title: "Cells",
  description: null,
  language: "en",
  objectives: [],
  cards: [],
  tags: [],
  licence: null,
  ai: {
    tutorInstructions: "Probe reasoning.",
    quizInstructions: null,
    cardGenerationInstructions: null,
  },
};
const question = {
  question: "Why would ATP depletion affect cell transport?",
  objectiveId: null,
  teachingIntent: "Probe transfer beyond card recall.",
};
const input = {
  model: "study-model",
  input: "untrusted material",
  instructions: "Trusted tutor protocol",
};
const terminal = (result: unknown) => ({
  type: "response.completed",
  response: {
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }],
  },
});
const stream = (event: unknown) => new Response(`data: ${JSON.stringify(event)}\n\n`);
function fixture(fetch: (url: string, init: RequestInit) => Promise<Response>, timeoutMs = 1_000) {
  let epoch = 0;
  const listeners = new Set<() => void>();
  const auth = {
    epoch: () => epoch,
    status: Effect.sync(() => ({
      activeClientId: "client",
      accounts: [
        { clientId: "client", email: null, label: "ChatGPT", signedIn: true, planEnabled: true },
      ],
    })),
    accessToken: () => Effect.succeed("private-access-token"),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    client: createNativeChatGPTPlanClient({ auth, fetch, timeoutMs }),
    changeAccount: () => {
      epoch += 1;
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
}
function local(client: ReturnType<typeof fixture>["client"], entries = new Map<string, string>()) {
  let id = 0;
  let writable = true;
  const ports: LocalTutorPorts = {
    model: input.model,
    knowledgeAreaId: area.id,
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    assertCurrent: Effect.suspend(() =>
      writable ? client.assertCurrent("client") : Effect.fail(nativePlanFailure("account-changed")),
    ),
    failure: nativePlanFailure,
    read: (key) => Effect.succeed(entries.get(key) ?? null),
    write: (batch) =>
      Effect.sync(() => {
        for (const [key, value] of batch) entries.set(key, value);
      }),
    infer: (request) => client.infer("client", request),
  };
  return {
    api: createLocalTutorApi(ports),
    entries,
    stopWrites: () => {
      writable = false;
    },
  };
}

await test("native catalog and tutor requests go directly to OpenAI with account-scoped models and trusted instructions", async () => {
  const calls: { readonly url: string; readonly init: RequestInit }[] = [];
  const f = fixture((url, init) => {
    calls.push({ url, init });
    return Promise.resolve(
      url.endsWith("models")
        ? Response.json({
            models: [
              { slug: "study-model", display_name: "Study", visibility: "list" },
              { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
            ],
          })
        : stream(terminal(question)),
    );
  });
  const models = await Effect.runPromise(f.client.models("client"));
  assert.deepEqual(
    models.map((model) => model.slug),
    ["study-model"],
  );
  const tutor = local(f.client);
  const response = await Effect.runPromise(
    tutor.api.request({ action: "question", context: { knowledgeArea: area, history: [] } }),
  );
  assert.equal(response.action, "question");
  assert.equal(response.result.question, question.question);
  assert.equal(calls[1]?.url, "https://api.openai.com/v1/responses");
  const body = await Effect.runPromise(
    Schema.decodeUnknown(
      Schema.parseJson(
        Schema.Struct({
          model: Schema.String,
          instructions: Schema.String,
          store: Schema.Boolean,
          stream: Schema.Boolean,
          input: Schema.Array(Schema.Struct({ content: Schema.String })),
        }),
      ),
    )(calls[1].init.body),
  );
  assert.equal(body.model, "study-model");
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.match(body.instructions, /do not copy a card front verbatim/);
  assert.equal(body.instructions.includes("private-access-token"), false);
  assert.equal(calls[1].init.redirect, "error");
  // A new adapter instance can restore the saved session after a process restart.
  const restored = local(f.client, tutor.entries);
  assert.equal(
    (await Effect.runPromise(restored.api.readSession(response.sessionId)))?.history.at(-1)
      ?.content,
    question.question,
  );
  assert.equal(JSON.stringify([...tutor.entries]).includes("private-access-token"), false);
});

await test("truncated streams, invalid objectives, and exhausted plan limits cannot save tutor sessions", async () => {
  for (const reply of [
    () => stream({ type: "response.output_text.delta", delta: "partial answer" }),
    () => stream(terminal({ ...question, objectiveId: "invented-objective" })),
    () =>
      stream({
        type: "response.failed",
        response: {
          error: {
            code: "subscription_sharing_usage_limit_exceeded",
            message: "vendor private detail",
          },
        },
      }),
    () =>
      Response.json(
        {
          error: {
            code: "subscription_sharing_user_not_eligible",
            message: "vendor private detail",
          },
        },
        { status: 403 },
      ),
  ]) {
    let calls = 0;
    const f = fixture(() => {
      calls += 1;
      return Promise.resolve(reply());
    });
    const tutor = local(f.client);
    const response = await Effect.runPromise(
      Effect.either(
        tutor.api.request({ action: "question", context: { knowledgeArea: area, history: [] } }),
      ),
    );
    assert.ok(Either.isLeft(response));
    assert.equal(tutor.entries.size, 0);
    assert.equal(calls, 1); // No hosted fallback or hidden retry.
    assert.equal(JSON.stringify(response.left).includes("vendor private detail"), false);
  }
});

await test("account changes abort active requests and discard even a completed response", async () => {
  let change = () => {};
  const f = fixture((_url, init) => {
    change();
    assert.equal(init.signal?.aborted, true);
    return Promise.resolve(stream(terminal(question)));
  });
  change = f.changeAccount;
  const tutor = local(f.client);
  const response = await Effect.runPromise(
    Effect.either(
      tutor.api.request({ action: "question", context: { knowledgeArea: area, history: [] } }),
    ),
  );
  assert.ok(Either.isLeft(response));
  assert.equal(tutor.entries.size, 0);
});

await test("workspace cleanup during inference prevents stale writes", async () => {
  let stop = () => {};
  const f = fixture(() => {
    stop();
    return Promise.resolve(stream(terminal(question)));
  });
  const tutor = local(f.client);
  stop = tutor.stopWrites;
  const response = await Effect.runPromise(
    Effect.either(
      tutor.api.request({ action: "question", context: { knowledgeArea: area, history: [] } }),
    ),
  );
  assert.ok(Either.isLeft(response));
  assert.equal(tutor.entries.size, 0);
});

await test("request deadlines cover stream consumption and release the inference lock", async () => {
  let attempt = 0;
  const f = fixture((_url, init) => {
    attempt += 1;
    if (attempt > 1) return Promise.resolve(stream(terminal(question)));
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            init.signal?.addEventListener("abort", () => {
              controller.error(new Error("aborted transport"));
            });
          },
        }),
      ),
    );
  }, 10);
  const timedOut = await Effect.runPromise(Effect.either(f.client.infer("client", input)));
  assert.ok(Either.isLeft(timedOut));
  assert.match(JSON.stringify(timedOut.left), /too long/);
  assert.equal(await Effect.runPromise(f.client.infer("client", input)), JSON.stringify(question));
});

await test("local proposals survive restart and still require explicit approval", async () => {
  const answers: readonly unknown[] = [
    question,
    {
      result: "incorrect",
      confidence: 0.8,
      feedback: "ATP powers active transport.",
      misconception: "Assumes transport never needs energy.",
      objectiveId: null,
      suggestedAction: "propose-card",
    },
    {
      front: "Why can ATP depletion stop active transport?",
      back: "Active transport needs ATP as an energy source.",
      objectiveId: null,
      rationale: "Addresses the recorded energy misconception.",
    },
  ];
  let turn = 0;
  const f = fixture(() => Promise.resolve(stream(terminal(answers[turn++]))));
  const tutor = local(f.client);
  const asked = await Effect.runPromise(
    tutor.api.request({ action: "question", context: { knowledgeArea: area, history: [] } }),
  );
  await Effect.runPromise(
    tutor.api.request({
      action: "evaluate",
      sessionId: asked.sessionId,
      answer: "Transport never needs energy.",
    }),
  );
  const proposed = await Effect.runPromise(
    tutor.api.request({ action: "propose-card", sessionId: asked.sessionId }),
  );
  assert.equal(proposed.action, "propose-card");
  const restored = local(f.client, tutor.entries);
  const pending = await Effect.runPromise(restored.api.readSession(asked.sessionId));
  assert.equal(pending?.proposal?.proposalId, proposed.proposalId);
  await Effect.runPromise(
    restored.api.resolveProposal({
      proposalId: proposed.proposalId,
      state: "approved",
      cardId: proposed.proposalId,
      content: proposed.result,
    }),
  );
  await Effect.runPromise(
    restored.api.resolveProposal({
      proposalId: proposed.proposalId,
      state: "approved",
      cardId: proposed.proposalId,
      content: proposed.result,
    }),
  );
  const approved = await Effect.runPromise(restored.api.readSession(asked.sessionId));
  assert.equal(approved?.proposal, null);

  assert.equal(area.cards.length, 0); // The UI's separately validated durable card save owns deck changes.
});
