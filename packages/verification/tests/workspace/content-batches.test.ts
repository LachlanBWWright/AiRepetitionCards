import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { createAreaId, createAssessmentId } from "@recall/domain";
import { workspaceContentBatches } from "../../../application/src/workspace/sync/content-batches";
import { knowledgeArea } from "../fixtures/search-workspace";
await test("content batching preserves atomic subjects and routes tombstones to their subject batch", () => {
  const base = knowledgeArea();
  const area = (id: string) => ({
    document: { ...base, id: createAreaId(id), description: "a".repeat(3_000_000) },
    color: "#123456",
    baseContentHash: null,
  });
  const first = area("first"),
    second = area("second");
  const cardId = base.cards[0]?.id;
  assert.ok(cardId);
  const batches = Effect.runSync(
    workspaceContentBatches({
      schemaVersion: 1,
      areas: [first, second],
      tombstones: [
        { areaId: first.document.id, cardId },
        { areaId: second.document.id, cardId },
      ],
    }),
  );
  assert.equal(batches.length, 2);
  assert.deepEqual(
    batches.flatMap((batch) => batch.areas.map((item) => item.document.id)),
    [first.document.id, second.document.id],
  );
  assert.equal(batches[0]?.tombstones[0]?.areaId, first.document.id);
  assert.equal(batches[1]?.tombstones[0]?.areaId, second.document.id);
});

await test("a fifty-thousand-card subject stays atomic and mass deletions use bounded tombstone-only batches", () => {
  const base = knowledgeArea();
  const card = base.cards[0];
  assert.ok(card);
  const document = {
    ...base,
    cards: Array.from({ length: 50_000 }, (_, index) => ({
      ...card,
      id: createAssessmentId(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
    })),
  };
  const batches = Effect.runSync(
    workspaceContentBatches({
      schemaVersion: 1,
      areas: [{ document, color: "#123456", baseContentHash: null }],
      tombstones: [],
    }),
  );
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.areas[0]?.document.cards.length, 50_000);
  const tombstones = document.cards
    .slice(0, 5_001)
    .map((item) => ({ areaId: base.id, cardId: item.id }));
  const deleted = Effect.runSync(
    workspaceContentBatches({
      schemaVersion: 1,
      areas: [{ document, color: "#123456", baseContentHash: null }],
      tombstones,
    }),
  );
  assert.equal(deleted.length, 3);
  assert.ok(deleted.every((batch) => batch.tombstones.length <= 2_000));
  assert.equal(deleted.flatMap((batch) => batch.tombstones).length, 5_001);
  assert.equal(deleted[0]?.areas[0]?.document.cards.length, 44_999);
  assert.deepEqual(
    deleted.flatMap((batch) => batch.tombstones),
    tombstones,
  );
  assert.deepEqual(deleted[0].areas[0].document.cards, document.cards.slice(5_001));
  assert.equal(deleted[1]?.areas.length, 0);
});

await test("tombstones cannot remove a matching legacy card ID from a different subject", () => {
  const base = knowledgeArea();
  const first = { document: base, color: "#123456", baseContentHash: null };
  const second = { ...first, document: { ...base, id: createAreaId("other-subject") } };
  const card = base.cards[0];
  assert.ok(card);
  const batches = Effect.runSync(
    workspaceContentBatches({
      schemaVersion: 1,
      areas: [first, second],
      tombstones: [{ areaId: base.id, cardId: card.id }],
    }),
  );
  assert.equal(batches[0]?.areas[0]?.document.cards.length, 0);
  assert.deepEqual(batches[0].areas[1]?.document.cards, base.cards);
});

await test("new links, removed links, and card moves remain in the same atomic batch", () => {
  const base = knowledgeArea();
  const source = { ...base, cards: [], description: "s".repeat(3_000_000) };
  const destination = {
    ...base,
    id: createAreaId("destination"),
    description: "d".repeat(3_000_000),
    noteLibrary: {
      types: [],
      notes: [
        {
          id: "note",
          typeId: "basic",
          fields: {},
          tags: [],
          objectiveIds: [],
          source: { areaId: source.id, noteId: "note", revision: "a".repeat(64) },
        },
      ],
    },
  };
  const entry = (document: typeof base) => ({ document, color: "#123456", baseContentHash: null });
  const batch = (documents: readonly (typeof base)[], previous: readonly (typeof base)[]) =>
    Effect.runSync(
      workspaceContentBatches(
        {
          schemaVersion: 1,
          areas: documents.map(entry),
          tombstones: [],
        },
        previous,
      ),
    );
  assert.equal(batch([source, destination], []).length, 1);
  const unlinked = { ...destination, noteLibrary: { types: [], notes: [] } };
  assert.equal(batch([source, unlinked], [source, destination]).length, 1);
  assert.equal(batch([source, unlinked], [base, { ...unlinked, cards: [] }]).length, 1);
  assert.equal(batch([source, { ...unlinked, cards: [] }], []).length, 2);
});

await test("oversized linked families fail instead of splitting a note transaction", () => {
  const base = knowledgeArea();
  const source = { ...base, description: "s".repeat(26_000_000) };
  const destination = {
    ...base,
    id: createAreaId("destination"),
    description: "d".repeat(26_000_000),
    noteLibrary: {
      types: [],
      notes: [
        {
          id: "note",
          typeId: "basic",
          fields: {},
          tags: [],
          objectiveIds: [],
          source: { areaId: source.id, noteId: "note", revision: "a".repeat(64) },
        },
      ],
    },
  };
  const result = Effect.runSync(
    Effect.either(
      workspaceContentBatches({
        schemaVersion: 1,
        areas: [source, destination].map((document) => ({
          document,
          color: "#123456",
          baseContentHash: null,
        })),
        tombstones: [],
      }),
    ),
  );
  assert.equal(result._tag, "Left");
});

await test("pending area deletions retain old family documents until their tombstone is accepted", async () => {
  const { deletingContentProvisions } =
    await import("../../../application/src/workspace/sync/deleting-content-provisions");
  const document = knowledgeArea();
  const remote = { document, color: "#123456", contentHash: "a".repeat(64) };
  const before = {
    schemaVersion: 1 as const,
    ownerId: "owner",
    areas: [remote],
    deletedAreaIds: [],
  };
  assert.deepEqual(deletingContentProvisions(before, new Set([document.id])), [
    { ...remote, baseContentHash: remote.contentHash },
  ]);
  assert.deepEqual(deletingContentProvisions(before, new Set()), []);
  assert.deepEqual(
    deletingContentProvisions({ ...before, deletedAreaIds: [document.id] }, new Set([document.id])),
    [],
  );
});
