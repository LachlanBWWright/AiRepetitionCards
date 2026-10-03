import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Effect, Either, Schema } from "effect";
import {
  createPublishingApi,
  createTutorApi,
  preparePublication,
  publicationContentHash,
  tutorApiFailureMessage,
  type PublishingApiFailure,
  type TutorApiFailure,
} from "@recall/application";
import { ApiRateLimitErrorResponseSchema } from "@recall/contracts";
import { KnowledgeAreaSchema } from "@recall/domain";

const areaId = "00000000-0000-4000-8000-000000000101";
const cardId = "00000000-0000-4000-8000-000000000102";
const objectiveId = "00000000-0000-4000-8000-000000000103";
const versionId = "00000000-0000-4000-8000-000000000104";
const operationId = "00000000-0000-4000-8000-000000000105";
const sessionId = "00000000-0000-4000-8000-000000000106";
const proposalId = "00000000-0000-4000-8000-000000000107";
const createdAt = "2026-10-03T09:00:00.000Z";

function valid<A, I>(schema: Schema.Schema<A, I>, input: unknown): A {
  const decoded = Schema.decodeUnknownEither(schema)(input);
  assert.ok(Either.isRight(decoded));
  return decoded.right;
}
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}
const document = valid(KnowledgeAreaSchema, {
  schemaVersion: "1.0.0",
  id: areaId,
  title: "Energy",
  description: null,
  language: "en",
  objectives: [{ id: objectiveId, title: "Explain ATP", description: null, prerequisiteIds: [] }],
  ai: {
    tutorInstructions: "Ask one question at a time.",
    quizInstructions: null,
    cardGenerationInstructions: null,
  },
  cards: [
    {
      kind: "basic",
      id: cardId,
      front: "What supplies cellular energy?",
      back: "ATP",
      objectiveIds: [objectiveId],
      tags: ["biology"],
      origin: "authored",
    },
  ],
  tags: [],
  licence: "CC BY 4.0",
  attribution: "Original author",
});
const version = {
  id: versionId,
  sourceAreaId: areaId,
  version: 1,
  content: document,
  contentHash: publicationContentHash(document),
  visibility: "public",
  attribution: document.attribution,
  license: document.licence,
  forkedFromVersionId: null,
  createdAt,
};
const forkDocument = valid(KnowledgeAreaSchema, { ...document, forkedFromVersionId: versionId });
const forkReceipt = {
  schemaVersion: 1,
  operationId,
  saved: true,
  areaId,
  document: forkDocument,
  contentHash: publicationContentHash(forkDocument),
  attribution: document.attribution,
  license: document.licence,
  forkedFromVersionId: versionId,
};
const publishingApi = (body: unknown) =>
  createPublishingApi(() => Effect.succeed({ status: 200, body }));
function invalidPublication(operation: Effect.Effect<unknown, PublishingApiFailure>) {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left._tag, "PublishingApiFailure");
  assert.equal(result.left.reason, "invalid-response");
}

void test("publication reads validate exact content hash before exposing content", () => {
  assert.deepEqual(
    success(publishingApi({ schemaVersion: 1, version }).read(versionId)).version.content,
    document,
  );
  for (const receipt of [
    { ...version, contentHash: "a".repeat(64) },
    { ...version, content: { ...document, title: "Tampered title" } },
    {
      ...version,
      content: {
        ...document,
        cards: document.cards.map((card) => ({ ...card, tags: ["tampered"] })),
      },
    },
  ])
    invalidPublication(publishingApi({ schemaVersion: 1, version: receipt }).read(versionId));
});

void test("fork receipts validate content hash before providing a sync baseline", () => {
  assert.equal(
    success(publishingApi(forkReceipt).fork(versionId, operationId)).contentHash,
    publicationContentHash(forkDocument),
  );
  for (const receipt of [
    { ...forkReceipt, contentHash: "a".repeat(64) },
    { ...forkReceipt, document: { ...forkDocument, title: "Tampered copy" } },
    {
      ...forkReceipt,
      document: {
        ...forkDocument,
        ai: { ...forkDocument.ai, tutorInstructions: "Changed policy" },
      },
    },
  ])
    invalidPublication(publishingApi(receipt).fork(versionId, operationId));
});

void test("publish acknowledgments must match normalized submitted content and identity", () => {
  const request = {
    operationId,
    sourceAreaId: areaId,
    content: document,
    visibility: "public",
    license: " CC BY-SA 4.0 ",
    attribution: " New author ",
    reuseConfirmed: true,
  };
  const prepared = success(preparePublication(request));
  const receipt = {
    schemaVersion: 1,
    operationId,
    version: {
      ...version,
      content: prepared.content,
      contentHash: publicationContentHash(prepared.content),
      license: prepared.license,
      attribution: prepared.attribution,
    },
  };
  assert.deepEqual(
    success(publishingApi(receipt).publish(request)).version.content,
    prepared.content,
  );
  const changed = valid(KnowledgeAreaSchema, {
    ...prepared.content,
    description: "Unexpected content",
  });
  for (const body of [
    { ...receipt, version: { ...receipt.version, contentHash: "a".repeat(64) } },
    {
      ...receipt,
      version: {
        ...receipt.version,
        content: changed,
        contentHash: publicationContentHash(changed),
      },
    },
    {
      ...receipt,
      version: {
        ...receipt.version,
        content: document,
        contentHash: publicationContentHash(document),
      },
    },
    { ...receipt, operationId: proposalId },
  ])
    invalidPublication(publishingApi(body).publish(request));
});

function tutorOperations(status: number, body: unknown) {
  const api = createTutorApi(() => Effect.succeed({ status, body }));
  return [
    api
      .request({ action: "question", context: { knowledgeArea: document, history: [] } })
      .pipe(Effect.asVoid),
    api.readSession(sessionId).pipe(Effect.asVoid),
    api.resolveProposal({ proposalId, state: "rejected" }),
  ];
}
function tutorFailure(operation: Effect.Effect<unknown, TutorApiFailure>): TutorApiFailure {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isLeft(result));
  return result.left;
}

void test("tutor limit envelopes preserve every valid bounded retry delay across operations", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 60 }), (retryAfterSeconds) => {
      for (const [status, error] of [
        [429, "rate-limited"],
        [503, "rate-limit-unavailable"],
      ] as const) {
        const body = { error, retryAfterSeconds };
        valid(ApiRateLimitErrorResponseSchema, body);
        for (const operation of tutorOperations(status, body)) {
          const failure = tutorFailure(operation);
          assert.ok(failure._tag === "TutorApiFailure" && failure.reason === "http");
          assert.equal(failure.code, error);
          assert.equal(failure.retryAfterSeconds, retryAfterSeconds);
          assert.match(
            tutorApiFailureMessage(failure),
            new RegExp(`Wait ${String(retryAfterSeconds)} seconds`),
          );
        }
      }
    }),
    { seed: 61027, numRuns: 40 },
  );
});

void test("legacy limit envelopes default to sixty seconds without fabricated delay metadata", () => {
  for (const [status, error] of [
    [429, "rate-limited"],
    [503, "rate-limit-unavailable"],
  ] as const)
    for (const operation of tutorOperations(status, { error })) {
      const failure = tutorFailure(operation);
      assert.ok(failure._tag === "TutorApiFailure" && failure.reason === "http");
      assert.equal(failure.retryAfterSeconds, undefined);
      assert.match(tutorApiFailureMessage(failure), /Wait 60 seconds/);
    }
});

void test("malformed limiter retry delays never enter actionable HTTP failures", () => {
  for (const retryAfterSeconds of [
    0,
    -1,
    61,
    1.5,
    "45",
    null,
    {},
    [],
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])
    for (const [status, error] of [
      [429, "rate-limited"],
      [503, "rate-limit-unavailable"],
    ] as const) {
      const body = { error, retryAfterSeconds };
      assert.ok(Either.isLeft(Schema.decodeUnknownEither(ApiRateLimitErrorResponseSchema)(body)));
      for (const operation of tutorOperations(status, body)) {
        const failure = tutorFailure(operation);
        assert.ok(failure._tag === "TutorApiFailure");
        assert.equal(failure.reason, "invalid-response");
      }
    }
});

void test("known limiter codes reject mismatched statuses rather than becoming success or missing sessions", () => {
  for (const error of ["rate-limited", "rate-limit-unavailable"])
    for (const status of [200, 401, 404, 429, 500, 503]) {
      if (status === (error === "rate-limited" ? 429 : 503)) continue;
      for (const operation of tutorOperations(status, { error, retryAfterSeconds: 45 })) {
        const failure = tutorFailure(operation);
        assert.ok(failure._tag === "TutorApiFailure");
        assert.equal(failure.reason, "invalid-response");
      }
    }
});

function requestFailure(status: number, body: unknown): TutorApiFailure {
  const operation = tutorOperations(status, body)[0];
  assert.ok(operation);
  return tutorFailure(operation);
}

void test("tutor recovery messages distinguish throttle, unavailable storage and daily budget", () => {
  const budget = "Your daily tutor budget has been used. Try again tomorrow.";
  const daily = requestFailure(429, { error: budget });
  assert.equal(tutorApiFailureMessage(daily), budget);
  const throttled = requestFailure(429, { error: "rate-limited", retryAfterSeconds: 45 });
  const unavailable = requestFailure(503, {
    error: "rate-limit-unavailable",
    retryAfterSeconds: 60,
  });
  assert.match(tutorApiFailureMessage(throttled), /Too many tutor requests/);
  assert.match(tutorApiFailureMessage(unavailable), /temporarily unavailable/);
  assert.notEqual(tutorApiFailureMessage(throttled), tutorApiFailureMessage(unavailable));
});

void test("unknown and inherited prototype error names cannot leak non-string messages", () => {
  for (const code of [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "unknown-error",
  ])
    for (const operation of tutorOperations(500, { error: code })) {
      const message = tutorApiFailureMessage(tutorFailure(operation));
      assert.equal(typeof message, "string");
      assert.equal(
        message,
        "Tutor could not complete that request. Your current work remains available; try again.",
      );
    }
});
