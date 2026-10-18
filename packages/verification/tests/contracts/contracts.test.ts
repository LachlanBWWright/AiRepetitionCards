import test from "node:test";
import {
  assert,
  Effect,
  Either,
  Contracts,
  first,
  second,
  third,
  hash,
  token,
  timestamp,
  impossibleTimestamp,
  document,
  version,
  review,
  media,
  valid,
  invalid,
  codec,
} from "./contracts-test-support.js";

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
