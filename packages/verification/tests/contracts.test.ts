import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import * as Contracts from "@recall/contracts";
import {
  TutorApiRequestSchema,
  TutorApiResponseSchema,
  TutorSessionStateResponseSchema,
  ResolveTutorProposalRequestSchema,
  ResolveTutorProposalResponseSchema,
} from "@recall/ai-core";
import {
  createPublishingApi,
  preparePublication,
  publicationContentHash,
} from "@recall/application";
import { KnowledgeAreaSchema } from "@recall/domain";

const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const third = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const hash = "a".repeat(64);
const token = "A".repeat(43);
const timestamp = "2026-10-03T12:30:00.000Z";
const impossibleTimestamp = "2026-02-30T12:30:00.000Z";
const card = {
  kind: "basic",
  id: second,
  front: "Question",
  back: "Answer",
  objectiveIds: [third],
  tags: [],
  origin: "authored",
};
const document = {
  schemaVersion: "1.0.0",
  id: first,
  title: "Area",
  description: null,
  language: "en",
  objectives: [{ id: third, title: "Objective", description: null, prerequisiteIds: [] }],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [card],
  tags: [],
  licence: "CC-BY-4.0",
  attribution: null,
};
const version = {
  id: second,
  sourceAreaId: first,
  version: 1,
  content: document,
  contentHash: publicationContentHash(valid(KnowledgeAreaSchema, document)),
  visibility: "public",
  attribution: null,
  license: "CC-BY-4.0",
  forkedFromVersionId: null,
  createdAt: timestamp,
};
const review = {
  id: first,
  cardId: second,
  deviceSequence: 1,
  baseReviewEventId: null,
  reviewedAtDevice: timestamp,
  effectiveReviewedAt: timestamp,
  rating: "good",
  elapsedMs: null,
  schedulerFamily: "fsrs",
  schedulerVersion: "6",
  schedulerParameterSetId: null,
  previousStateHash: null,
};
const publicQuestion = {
  action: "question",
  sessionId: first,
  result: { question: "Question", objectiveId: third, teachingIntent: "Recall" },
};
const context = { knowledgeArea: document, history: [] };
const media = { id: hash, mimeType: "image/png", byteLength: 42 };
const exportData = {
  knowledgeAreas: [],
  knowledgeAreaVersions: [],
  learningObjectives: [],
  objectivePrerequisites: [],
  cards: [],
  cardRevisions: [],
  cardObjectives: [],
  reviewEvents: [],
  schedulingState: [],
  syncChanges: [],
  tutorSessions: [],
  tutorMessages: [],
  aiObservations: [],
  generatedCardProposals: [],
  aiUsage: [],
};
const accountExport = {
  format: "recall-account-export",
  version: 1,
  exportedAt: timestamp,
  account: { userId: first, profile: null },
  data: exportData,
};

function valid<A, I>(schema: Schema.Schema<A, I>, input: unknown): A {
  const decoded = Schema.decodeUnknownEither(schema)(input);
  assert.ok(Either.isRight(decoded), `Expected valid input: ${JSON.stringify(input)}`);
  return decoded.right;
}
function invalid<A, I>(schema: Schema.Schema<A, I>, input: unknown) {
  assert.ok(
    Either.isLeft(Schema.decodeUnknownEither(schema)(input)),
    `Expected invalid input: ${JSON.stringify(input)}`,
  );
}
function codec<A, I>(
  name: string,
  schema: Schema.Schema<A, I>,
  accepted: readonly unknown[],
  rejected: readonly unknown[],
) {
  void test(name, () => {
    for (const value of accepted) valid(schema, value);
    for (const value of rejected) invalid(schema, value);
  });
}

codec(
  "publication identity codecs canonicalize valid UUIDs and reject invalid version/variant bits",
  Contracts.PublicationVersionIdSchema,
  [first, first.toUpperCase()],
  [
    "bad-id",
    "00000000-0000-0000-0000-000000000000",
    first.replace("4aaa", "0aaa"),
    first.replace("8aaa", "7aaa"),
  ],
);
void test("UUID identity normalization precedes duplicate checking", () => {
  assert.equal(valid(Contracts.PublicationVersionIdSchema, first.toUpperCase()), first);
  valid(Contracts.WorkspaceReviewIdentitiesRequestSchema, {
    schemaVersion: 1,
    cardIds: [first, second],
  });
  for (const cardIds of [
    [],
    [first, first],
    [first, first.toUpperCase()],
    Array.from({ length: 101 }, () => first),
  ])
    invalid(Contracts.WorkspaceReviewIdentitiesRequestSchema, { schemaVersion: 1, cardIds });
  const response = {
    schemaVersion: 1,
    ownerId: first,
    reviewCards: [{ id: second, areaId: first, deleted: false }],
  };
  valid(Contracts.WorkspaceReviewIdentitiesResponseSchema, response);
  invalid(Contracts.WorkspaceReviewIdentitiesResponseSchema, {
    ...response,
    reviewCards: [response.reviewCards[0], response.reviewCards[0]],
  });
  invalid(Contracts.WorkspaceReviewIdentitiesResponseSchema, { ...response, schemaVersion: 2 });
});
codec(
  "share tokens have exact URL-safe syntax",
  Contracts.PublishedShareTokenSchema,
  [token, "_".repeat(43), "-".repeat(43)],
  ["", "A".repeat(42), "A".repeat(44), "+".repeat(43), "/".repeat(43), `${token}=`, ` ${token}`],
);
codec(
  "single token query codec rejects arrays and malformed token values",
  Contracts.PublishedShareTokenQuerySchema,
  [{}, { token }],
  [{ token: [token] }, { token: [token, token] }, { token: "bad" }, { token: null }],
);
codec(
  "tutor query codec accepts exactly one UUID",
  Contracts.TutorSessionQuerySchema,
  [{ sessionId: [first] }],
  [
    {},
    { sessionId: [] },
    { sessionId: [first, second] },
    { sessionId: first },
    { sessionId: ["bad"] },
  ],
);
void test("sync cursor decoder validates single values and defaults omission to zero", () => {
  for (const [input, expected] of [
    [{}, "0"],
    [{ cursor: [] }, "0"],
    [{ cursor: ["123"] }, "123"],
  ] as const) {
    const decoded = Effect.runSync(Effect.either(Contracts.decodeSyncPullQuery(input)));
    assert.ok(Either.isRight(decoded));
    assert.equal(decoded.right.cursor, expected);
  }
  for (const input of [
    { cursor: ["1", "2"] },
    { cursor: ["-1"] },
    { cursor: ["1.5"] },
    { cursor: ["1".repeat(21)] },
    { cursor: "1" },
  ])
    assert.ok(Either.isLeft(Effect.runSync(Effect.either(Contracts.decodeSyncPullQuery(input)))));
});
void test("review push decoder rejects unknown versions and bounds its batch", () => {
  const request = { schemaVersion: 1, deviceId: third, operations: [review] };
  assert.ok(
    Either.isRight(Effect.runSync(Effect.either(Contracts.decodeSyncPushRequest(request)))),
  );
  for (const input of [
    { ...request, schemaVersion: 2 },
    { ...request, deviceId: "bad" },
    { ...request, operations: Array.from({ length: 101 }, () => review) },
  ])
    assert.ok(Either.isLeft(Effect.runSync(Effect.either(Contracts.decodeSyncPushRequest(input)))));
  for (const operation of [
    { ...review, deviceSequence: 0 },
    { ...review, elapsedMs: -1 },
    { ...review, previousStateHash: "bad" },
    { ...review, schedulerVersion: "x".repeat(81) },
    { ...review, schedulerFamily: "unknown" },
    { ...review, effectiveReviewedAt: impossibleTimestamp },
  ])
    invalid(Contracts.SyncReviewOperationSchema, operation);
});
codec(
  "review response envelopes validate version/cursor/rating and bounded receipts",
  Contracts.SyncPushResponseSchema,
  [{ schemaVersion: 1, acceptedIds: [first], conflicts: [], cursor: "1" }],
  [
    { schemaVersion: 2, acceptedIds: [first], conflicts: [], cursor: "1" },
    { schemaVersion: 1, acceptedIds: ["bad"], conflicts: [], cursor: "1" },
    {
      schemaVersion: 1,
      acceptedIds: [],
      conflicts: [{ id: first, reason: "unknown" }],
      cursor: "1",
    },
    { schemaVersion: 1, acceptedIds: [], conflicts: [], cursor: "-1" },
  ],
);
codec(
  "sync pull envelopes reject unknown entity operations and cursor bounds",
  Contracts.SyncPullResponseSchema,
  [{ schemaVersion: 1, changes: [], cursor: "0", hasMore: false }],
  [
    { schemaVersion: 2, changes: [], cursor: "0", hasMore: false },
    {
      schemaVersion: 1,
      changes: [
        {
          sequence: "0",
          operationId: first,
          createdAt: timestamp,
          entityType: "area",
          entityId: first,
          operation: "tombstone",
          payload: { id: first, deletedAt: timestamp },
        },
      ],
      cursor: "0",
      hasMore: false,
    },
  ],
);

codec(
  "workspace snapshot requires a versioned owner-scoped content envelope",
  Contracts.WorkspaceSnapshotSchema,
  [
    {
      schemaVersion: 1,
      ownerId: first,
      areas: [{ document, color: "#123456", contentHash: hash }],
      deletedAreaIds: [],
    },
  ],
  [
    { schemaVersion: 2, ownerId: first, areas: [], deletedAreaIds: [] },
    { schemaVersion: 1, ownerId: "bad", areas: [], deletedAreaIds: [] },
  ],
);
codec(
  "workspace push bounds content and tombstones",
  Contracts.WorkspaceContentPushRequestSchema,
  [
    {
      schemaVersion: 1,
      areas: [{ document, color: "#abcdef", baseContentHash: null }],
      tombstones: [],
    },
  ],
  [
    { schemaVersion: 2, areas: [], tombstones: [] },
    {
      schemaVersion: 1,
      areas: Array.from({ length: 101 }, () => ({
        document,
        color: "#abcdef",
        baseContentHash: null,
      })),
      tombstones: [],
    },
    {
      schemaVersion: 1,
      areas: [],
      tombstones: Array.from({ length: 2001 }, () => ({ areaId: first, cardId: second })),
    },
  ],
);
codec(
  "workspace delete and push acknowledgments have declared bounds",
  Contracts.WorkspaceAreaTombstoneRequestSchema,
  [{ areaTombstones: [{ areaId: first, baseContentHash: hash }] }],
  [
    { areaTombstones: [{ areaId: first, baseContentHash: "bad" }] },
    {
      areaTombstones: Array.from({ length: 101 }, () => ({ areaId: first, baseContentHash: hash })),
    },
  ],
);
codec(
  "workspace result counts are nonnegative integers",
  Contracts.WorkspaceContentPushResponseSchema,
  [{ schemaVersion: 1, syncedAreas: 0, syncedCards: 1 }],
  [
    { schemaVersion: 1, syncedAreas: -1, syncedCards: 1 },
    { schemaVersion: 1, syncedAreas: 0, syncedCards: 1.5 },
  ],
);

codec(
  "media envelopes validate declared MIME, hash and size",
  Contracts.PublishedMediaUploadResponseSchema,
  [
    { reference: media },
    { schemaVersion: 1, reference: media },
    { schemaVersion: 1, reference: { ...media, byteLength: 20_000_000 } },
  ],
  [
    { schemaVersion: 2, reference: media },
    { reference: { ...media, id: "bad" } },
    { reference: { ...media, mimeType: "text/html" } },
    { reference: { ...media, byteLength: 0 } },
    { reference: { ...media, byteLength: 20_000_001 } },
    { reference: { ...media, byteLength: 1.5 } },
  ],
);
codec(
  "published media routes validate publication ID and optional token",
  Contracts.PublishedMediaRouteRequestSchema,
  [
    { versionId: first, mediaId: hash },
    { versionId: first, mediaId: hash, token },
  ],
  [
    { versionId: "bad", mediaId: hash },
    { versionId: first, mediaId: hash, token: [token] },
    { versionId: first, mediaId: "bad" },
  ],
);
codec(
  "media route references validate both declared fields",
  Contracts.MediaReferenceRouteRequestSchema,
  [{ mediaId: hash, reference: media }],
  [
    { mediaId: "bad", reference: media },
    { mediaId: hash, reference: { ...media, byteLength: -1 } },
  ],
);

codec(
  "publishing retains additive legacy version compatibility while rejecting unknown versions",
  Contracts.PublishKnowledgeAreaRequestSchema,
  [
    { operationId: third, sourceAreaId: first, content: document, visibility: "public" },
    {
      schemaVersion: 1,
      operationId: third,
      sourceAreaId: first,
      content: document,
      visibility: "public",
    },
  ],
  [
    {
      schemaVersion: 2,
      operationId: third,
      sourceAreaId: first,
      content: document,
      visibility: "public",
    },
    { operationId: "bad", sourceAreaId: first, content: document, visibility: "public" },
    { operationId: third, sourceAreaId: first, content: document, visibility: "other" },
  ],
);
codec(
  "publishing response validates version/hash and calendar timestamps",
  Contracts.PublishKnowledgeAreaResponseSchema,
  [
    { operationId: third, version },
    {
      schemaVersion: 1,
      operationId: third,
      version: { ...version, createdAt: "2026-10-03T14:30:00+02:00" },
    },
  ],
  [
    { schemaVersion: 2, operationId: third, version },
    { operationId: third, version: { ...version, version: 0 } },
    { operationId: third, version: { ...version, contentHash: "bad" } },
    { operationId: third, version: { ...version, createdAt: impossibleTimestamp } },
    { operationId: third, version: { ...version, createdAt: "2026-10-03" } },
  ],
);
codec(
  "publication read response requires provenance metadata and valid timestamps",
  Contracts.ReadPublishedKnowledgeAreaResponseSchema,
  [{ schemaVersion: 1, version }],
  [
    { schemaVersion: 2, version },
    { version: { ...version, createdAt: impossibleTimestamp } },
    { version: { ...version, license: "x".repeat(121) } },
  ],
);
codec(
  "fork response requires saved acknowledgment and lineage",
  Contracts.ForkPublishedKnowledgeAreaResponseSchema,
  [
    {
      operationId: third,
      saved: true,
      areaId: first,
      contentHash: hash,
      document,
      attribution: null,
      license: "CC-BY-4.0",
      forkedFromVersionId: second,
    },
  ],
  [
    {
      operationId: third,
      saved: false,
      areaId: first,
      contentHash: hash,
      document,
      attribution: null,
      license: "CC-BY-4.0",
      forkedFromVersionId: second,
    },
    {
      operationId: third,
      saved: true,
      areaId: first,
      contentHash: hash,
      document,
      attribution: null,
      license: null,
      forkedFromVersionId: "bad",
    },
  ],
);
codec(
  "token lifecycle and typed publishing errors reject arbitrary actions/codes",
  Contracts.RotatePublishedShareTokenRequestSchema,
  [{ action: "rotate" }, { schemaVersion: 1, action: "revoke" }],
  [{ action: "delete" }, { schemaVersion: 2, action: "rotate" }],
);
codec(
  "typed publication errors and token acknowledgments have valid shapes",
  Contracts.PublishingErrorResponseSchema,
  [{ schemaVersion: 1, error: "invalid-share-token" }, { error: "publication-not-found" }],
  [{ error: "arbitrary-error" }, { schemaVersion: 2, error: "invalid-request" }],
);

void test("public codecs remove credential and learner-state fields", () => {
  const auth = valid(Contracts.AuthSessionResponseSchema, {
    schemaVersion: 1,
    authenticated: true,
    displayLabel: "Learner",
    ownerId: first,
    accessToken: "private",
    providerSubject: "private",
  });
  assert.deepEqual(
    Object.keys(auth).sort(),
    ["schemaVersion", "authenticated", "displayLabel", "ownerId"].sort(),
  );
  const response = valid(Contracts.ReadPublishedKnowledgeAreaResponseSchema, {
    version: {
      ...version,
      ownerId: first,
      shareToken: token,
      reviewEvents: [review],
      content: {
        ...document,
        reviewEvents: [review],
        cards: [{ ...card, schedule: { due: timestamp }, learnerAnswer: "private" }],
      },
    },
  });
  assert.equal("ownerId" in response.version, false);
  assert.equal("shareToken" in response.version, false);
  assert.equal("reviewEvents" in response.version, false);
  assert.equal("reviewEvents" in response.version.content, false);
  const publicCard = response.version.content.cards[0];
  assert.ok(publicCard);
  assert.equal("schedule" in publicCard, false);
  assert.equal("learnerAnswer" in publicCard, false);
});
codec(
  "public authentication status preserves signed-out privacy and bounds labels",
  Contracts.AuthSessionResponseSchema,
  [{ schemaVersion: 1, authenticated: false, displayLabel: null, ownerId: null }],
  [
    { schemaVersion: 1, authenticated: false, displayLabel: "private", ownerId: first },
    { schemaVersion: 1, authenticated: true, displayLabel: "", ownerId: first },
    { schemaVersion: 1, authenticated: true, displayLabel: "x".repeat(321), ownerId: first },
    { schemaVersion: 2, authenticated: false, displayLabel: null, ownerId: null },
  ],
);
codec(
  "private account export has exact version and UTC calendar timestamps",
  Contracts.AccountExportResponseSchema,
  [accountExport],
  [
    { ...accountExport, version: 2 },
    { ...accountExport, exportedAt: impossibleTimestamp },
    { ...accountExport, exportedAt: "2026-10-03T12:30:00+00:00" },
    { ...accountExport, data: {} },
  ],
);
codec(
  "account deletion requires explicit confirmation and literal success",
  Contracts.DeleteAccountRequestSchema,
  [{ confirmation: "DELETE" }],
  [{}, { confirmation: "delete" }, { confirmation: true }],
);
codec(
  "deletion acknowledgment cannot claim partial failure as success",
  Contracts.DeleteAccountResponseSchema,
  [{ deleted: true }],
  [{ deleted: false }, { deleted: "true" }, {}],
);
codec(
  "tutor privacy policies bound retention independently of content",
  Contracts.TutorPrivacyPolicySchema,
  [
    { schemaVersion: 1, retentionDays: null, deletionAvailable: true },
    { schemaVersion: 1, retentionDays: 365, deletionAvailable: true },
  ],
  [
    { schemaVersion: 2, retentionDays: 30, deletionAvailable: true },
    { schemaVersion: 1, retentionDays: 0, deletionAvailable: true },
    { schemaVersion: 1, retentionDays: 366, deletionAvailable: true },
  ],
);
codec(
  "tutor deletion requires its own explicit confirmation",
  Contracts.DeleteTutorHistoryRequestSchema,
  [{ confirmation: "DELETE_TUTOR_HISTORY" }],
  [{ confirmation: "DELETE" }, {}],
);
codec(
  "tutor deletion counts and bounded retention batches validate acknowledgments",
  Contracts.DeleteTutorHistoryResponseSchema,
  [{ schemaVersion: 1, deleted: true, deletedSessions: 0 }],
  [
    { schemaVersion: 1, deleted: false, deletedSessions: 0 },
    { schemaVersion: 1, deleted: true, deletedSessions: -1 },
  ],
);
codec(
  "retention result bounds server batch count",
  Contracts.TutorRetentionResponseSchema,
  [{ schemaVersion: 1, deletedSessions: 1000 }],
  [
    { schemaVersion: 1, deletedSessions: 1001 },
    { schemaVersion: 2, deletedSessions: 0 },
  ],
);
const telemetry = {
  schemaVersion: 1,
  requestId: first,
  operation: "tutor-action",
  status: 200,
  durationMs: 12,
  timestamp,
  unexpectedFailure: false,
};
codec(
  "sanitized operational telemetry validates operation/status/calendar boundaries",
  Contracts.HttpTelemetryEventSchema,
  [telemetry],
  [
    { ...telemetry, status: 600 },
    { ...telemetry, durationMs: -1 },
    { ...telemetry, operation: "other" },
    { ...telemetry, timestamp: impossibleTimestamp },
  ],
);

codec(
  "tutor request/response envelopes require supported schema versions",
  TutorApiRequestSchema,
  [{ schemaVersion: 1, request: { action: "question", context } }],
  [
    { schemaVersion: 2, request: { action: "question", context } },
    { schemaVersion: 1, request: { action: "evaluate", sessionId: first, answer: "" } },
  ],
);
codec(
  "tutor response envelopes validate result action and session identity",
  TutorApiResponseSchema,
  [{ schemaVersion: 1, response: publicQuestion }],
  [
    { schemaVersion: 2, response: publicQuestion },
    { schemaVersion: 1, response: { ...publicQuestion, sessionId: "bad" } },
  ],
);
codec(
  "tutor state response bounds chronological history",
  TutorSessionStateResponseSchema,
  [
    {
      schemaVersion: 1,
      state: { sessionId: first, history: [], evaluation: null, proposal: null, quiz: null },
    },
  ],
  [
    {
      schemaVersion: 1,
      state: {
        sessionId: first,
        history: Array.from({ length: 41 }, () => ({ role: "assistant", content: "q" })),
        evaluation: null,
        proposal: null,
        quiz: null,
      },
    },
  ],
);
codec(
  "proposal resolution intent and acknowledgment accept only approval/rejection states",
  ResolveTutorProposalRequestSchema,
  [
    { schemaVersion: 1, request: { proposalId: first, state: "approved", cardId: second } },
    { schemaVersion: 1, request: { proposalId: first, state: "rejected" } },
  ],
  [
    { schemaVersion: 1, request: { proposalId: first, state: "pending" } },
    { schemaVersion: 2, request: { proposalId: first, state: "rejected" } },
  ],
);
codec(
  "proposal response cannot acknowledge an unrecognized state",
  ResolveTutorProposalResponseSchema,
  [{ schemaVersion: 1, proposalId: first, state: "approved" }],
  [
    { schemaVersion: 1, proposalId: first, state: "pending" },
    { schemaVersion: 1, proposalId: "bad", state: "rejected" },
  ],
);

void test("publishing client rejects unrequested identities and incorrect token outcomes", async () => {
  const response = (body: unknown) =>
    createPublishingApi(() => Effect.succeed({ status: 200, body }));
  assert.ok(
    Either.isRight(
      await Effect.runPromise(Effect.either(response({ schemaVersion: 1, version }).read(second))),
    ),
  );
  for (const operation of [
    response({ version: { ...version, id: third } })
      .read(second)
      .pipe(Effect.asVoid),
    response({ versionId: third, token }).manageShareToken(second, "rotate").pipe(Effect.asVoid),
    response({ versionId: second, token: null })
      .manageShareToken(second, "rotate")
      .pipe(Effect.asVoid),
    response({ versionId: second, token }).manageShareToken(second, "revoke").pipe(Effect.asVoid),
  ]) {
    const result = await Effect.runPromise(Effect.either(operation));
    assert.ok(Either.isLeft(result));
    assert.ok(result.left._tag === "PublishingApiFailure");
    assert.equal(result.left.reason, "invalid-response");
  }
});
void test("publication rights and fork provenance require explicit coherent intent", () => {
  const request = {
    operationId: third,
    sourceAreaId: first,
    content: document,
    visibility: "public",
  };
  const prepared = Effect.runSync(Effect.either(preparePublication(request)));
  assert.ok(Either.isRight(prepared));
  assert.equal(prepared.right.forkedFromVersionId, null);
  assert.equal("forkedFromVersionId" in prepared.right.content, false);
  for (const input of [
    { ...request, content: { ...document, licence: null } },
    {
      ...request,
      content: { ...document, forkedFromVersionId: second },
      forkedFromVersionId: third,
    },
    { ...request, content: { ...document, sourceId: "imported-source" } },
    { ...request, visibility: "unlisted" },
    { ...request, shareToken: token },
  ])
    assert.ok(Either.isLeft(Effect.runSync(Effect.either(preparePublication(input)))));
  assert.ok(
    Either.isRight(
      Effect.runSync(
        Effect.either(
          preparePublication({
            ...request,
            content: { ...document, sourceId: "imported-source" },
            reuseConfirmed: true,
          }),
        ),
      ),
    ),
  );
});

void test("fork and publication update clients reject mismatched request lineage and identities", async () => {
  const api = (body: unknown) => createPublishingApi(() => Effect.succeed({ status: 200, body }));
  const fork = {
    schemaVersion: 1,
    operationId: third,
    saved: true,
    areaId: first,
    contentHash: publicationContentHash(
      valid(KnowledgeAreaSchema, { ...document, forkedFromVersionId: second }),
    ),
    document: { ...document, forkedFromVersionId: second },
    attribution: null,
    license: "CC-BY-4.0",
    forkedFromVersionId: second,
  };
  assert.ok(Either.isRight(await Effect.runPromise(Effect.either(api(fork).fork(second, third)))));
  for (const body of [
    { ...fork, operationId: first },
    { ...fork, forkedFromVersionId: third },
    { ...fork, document: { ...fork.document, id: third } },
    { ...fork, document: { ...fork.document, forkedFromVersionId: third } },
  ]) {
    const result = await Effect.runPromise(Effect.either(api(body).fork(second, third)));
    assert.ok(Either.isLeft(result));
    assert.ok(result.left._tag === "PublishingApiFailure");
    assert.equal(result.left.reason, "invalid-response");
  }
  const updates = {
    schemaVersion: 1,
    knownVersion: { id: second, version: 1, sourceAreaId: first },
    latestPublicVersion: { id: third, version: 2, sourceAreaId: first, createdAt: timestamp },
  };
  assert.ok(
    Either.isRight(
      await Effect.runPromise(
        Effect.either(api(updates).checkUpdates({ versionId: second, sourceAreaId: first })),
      ),
    ),
  );
  for (const body of [
    { ...updates, knownVersion: { ...updates.knownVersion, id: third } },
    { ...updates, latestPublicVersion: { ...updates.latestPublicVersion, sourceAreaId: second } },
    { ...updates, latestPublicVersion: { ...updates.latestPublicVersion, id: second } },
    { ...updates, latestPublicVersion: { ...updates.latestPublicVersion, version: 1 } },
  ]) {
    const result = await Effect.runPromise(
      Effect.either(api(body).checkUpdates({ versionId: second, sourceAreaId: first })),
    );
    assert.ok(Either.isLeft(result));
    assert.ok(result.left._tag === "PublishingApiFailure");
    assert.equal(result.left.reason, "invalid-response");
  }
});

void test("publication client binds acknowledgments to intent, document and provenance", async () => {
  const request = {
    operationId: third,
    sourceAreaId: first,
    content: document,
    visibility: "public",
  };
  const api = (body: unknown) => createPublishingApi(() => Effect.succeed({ status: 200, body }));
  const acknowledgment = { schemaVersion: 1, operationId: third, version };
  assert.ok(
    Either.isRight(await Effect.runPromise(Effect.either(api(acknowledgment).publish(request)))),
  );
  for (const body of [
    { ...acknowledgment, operationId: second },
    { ...acknowledgment, version: { ...version, content: { ...document, id: third } } },
    { ...acknowledgment, version: { ...version, sourceAreaId: third } },
    { ...acknowledgment, version: { ...version, visibility: "private" } },
    { ...acknowledgment, version: { ...version, forkedFromVersionId: third } },
    { ...acknowledgment, version: { ...version, license: "other-license" } },
    { ...acknowledgment, version: { ...version, attribution: "unrequested" } },
  ]) {
    const result = await Effect.runPromise(Effect.either(api(body).publish(request)));
    assert.ok(Either.isLeft(result));
    assert.ok(result.left._tag === "PublishingApiFailure");
    assert.equal(result.left.reason, "invalid-response");
  }
});
