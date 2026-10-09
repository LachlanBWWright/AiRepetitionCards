import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Effect, Either } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type Workspace,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import {
  applyWorkspaceAuthoringCommand,
  createStudyCard,
  formatTagInput,
  parseTagInput,
  recordReview,
  updateAreaSettings,
  updateStudyCard,
  workspaceAuthoringBaseline,
  type WorkspaceAuthoringCommand,
} from "@recall/application";

const now = new Date("2026-10-04T00:00:00.000Z");
const areaId = createAreaId("00000000-0000-4000-8000-000000000701");
const cardId = createAssessmentId("00000000-0000-4000-8000-000000000702");
const objectiveId = createObjectiveId("00000000-0000-4000-8000-000000000703");
const edgeTags = [
  "",
  "duplicate",
  "duplicate",
  "  padded  ",
  "a,b",
  'say "hi"',
  "\r",
  "\n",
  "\r\n",
];
const importedTags = [
  ...edgeTags,
  "long".repeat(25),
  ...Array.from({ length: 101 }, (_, index) => `tag-${String(index)}`),
];

function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}

function parsed(input: unknown): readonly string[] {
  const result = parseTagInput(input);
  assert.ok(Either.isRight(result));
  return result.right;
}

function workspace(): Workspace {
  const initial: Workspace = {
    schemaVersion: 1,
    reviews: 0,
    reviewEvents: [],
    areas: [
      {
        id: areaId,
        title: "Imported learning",
        color: "#112233",
        tags: importedTags,
        sourceId: "imported-area",
        forkedFromVersionId: "published-version",
        objectives: [
          { id: objectiveId, title: "Understand", description: null, prerequisiteIds: [] },
        ],
        cards: [
          {
            id: cardId,
            front: "Question",
            back: "Answer",
            objective: "Understand",
            objectiveIds: [objectiveId],
            origin: "imported",
            sourceId: "imported-card",
            tags: importedTags,
            schedule: newSchedule(now),
          },
        ],
      },
    ],
  };
  return success(
    recordReview({
      workspace: initial,
      areaId,
      cardId,
      eventId: "00000000-0000-4000-8000-000000000704",
      rating: "good",
      ratedAt: now.toISOString(),
    }),
  ).workspace;
}

const content = (tags: readonly string[]) => ({
  kind: "basic" as const,
  front: "Edited question",
  back: "Answer",
  objectiveIds: [objectiveId],
  tags,
  media: [],
});
const settings = (tags: readonly string[]) => ({
  description: "Edited description",
  language: "en",
  tags,
  licence: null,
  attribution: null,
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  objectives: [{ id: objectiveId, title: "Understand", description: null, prerequisiteIds: [] }],
});

void test("tag codec roundtrips arbitrary UTF-16 arrays, retaining exact text and order", () => {
  assert.deepEqual(parsed(formatTagInput(edgeTags)), edgeTags);
  assert.deepEqual(parsed(formatTagInput([])), []);
  fc.assert(
    fc.property(
      fc.array(
        fc.string({
          unit: fc.integer({ min: 0, max: 65535 }).map((code) => String.fromCharCode(code)),
        }),
        { maxLength: 120 },
      ),
      (tags) => {
        const snapshot = [...tags];
        assert.deepEqual(parsed(formatTagInput(tags)), tags);
        assert.deepEqual(tags, snapshot);
      },
    ),
    { numRuns: 300, seed: 701 },
  );
});

void test("quoted tags retain empty, whitespace, comma, quote and multiline values", () => {
  assert.deepEqual(parsed('"", "  ", "a,b", "say ""hi""", "a\r\nb"'), [
    "",
    "  ",
    "a,b",
    'say "hi"',
    "a\r\nb",
  ]);
  assert.deepEqual(parsed(" ,  alpha  , ,\t beta \r\n, ,"), ["alpha", "beta"]);
  assert.deepEqual(parsed(" \t\r\n, , "), []);
});

void test("malformed quoted lists and nonstring boundaries return typed failures", () => {
  for (const input of [
    '"open',
    '"closed"tail',
    'bare"quote',
    '"a" "b"',
    '"a";b',
    '"a", "unterminated',
    undefined,
    null,
    42,
    {},
    [],
    ["tag"],
  ]) {
    const result = parseTagInput(input);
    assert.ok(Either.isLeft(result));
    assert.equal(result.left._tag, "TagInputFailure");
    assert.match(result.left.message, /double quotes/);
  }
});

void test("unchanged imported card and area tags bypass authoring limits without changing learner evidence", () => {
  const original = workspace();
  const snapshot = JSON.stringify(original);
  const originalArea = original.areas[0];
  assert.ok(originalArea);
  const originalCard = originalArea.cards[0];
  assert.ok(originalCard);
  const tags = parsed(formatTagInput(importedTags));
  const commands: readonly WorkspaceAuthoringCommand[] = [
    { kind: "update-card", areaId, cardId, content: content(tags) },
    { kind: "update-area-settings", areaId, settings: settings(tags) },
  ];
  for (const command of commands) {
    const next = success(
      applyWorkspaceAuthoringCommand(
        original,
        command,
        now,
        workspaceAuthoringBaseline(original, command),
      ),
    ).workspace;
    const nextArea = next.areas[0];
    assert.ok(nextArea);
    const nextCard = nextArea.cards[0];
    assert.ok(nextCard);
    assert.deepEqual(nextArea.tags, importedTags);
    assert.deepEqual(nextCard.tags, importedTags);
    assert.deepEqual(next.reviewEvents, original.reviewEvents);
    assert.equal(next.reviews, original.reviews);
    assert.deepEqual(nextCard.schedule, originalCard.schedule);
    assert.equal(nextCard.origin, "imported");
    assert.equal(nextCard.sourceId, "imported-card");
    assert.equal(nextArea.sourceId, "imported-area");
    assert.equal(nextArea.forkedFromVersionId, "published-version");
    assert.equal(JSON.stringify(original), snapshot);
  }
});

void test("edited or newly authored tags enforce limits with typed failures and no mutation", () => {
  const original = workspace();
  const snapshot = JSON.stringify(original);
  for (const tags of [
    ["x".repeat(81)],
    Array.from({ length: 101 }, (_, index) => `new-${String(index)}`),
    [""],
    [" \r\n "],
  ]) {
    const cardResult = Effect.runSync(
      Effect.either(updateStudyCard(original, { areaId, cardId, content: content(tags) })),
    );
    assert.ok(Either.isLeft(cardResult));
    assert.equal(cardResult.left._tag, "CardManagementFailure");
    assert.equal(cardResult.left.reason, "invalid-input");
    const areaResult = Effect.runSync(
      Effect.either(updateAreaSettings(original.areas[0], settings(tags))),
    );
    assert.ok(Either.isLeft(areaResult));
    assert.equal(areaResult.left._tag, "AreaSettingsInvalid");
    assert.match(areaResult.left.message, /100 nonblank tags/);
    const createResult = Effect.runSync(
      Effect.either(
        createStudyCard(original, { areaId, cardId: "new-card", content: content(tags) }, now),
      ),
    );
    assert.ok(Either.isLeft(createResult));
    assert.equal(createResult.left.reason, "invalid-input");
    assert.equal(JSON.stringify(original), snapshot);
  }
});

void test("edited valid tags retain duplicates and exact whitespace at authoring limits", () => {
  const original = workspace();
  const tags = Array.from({ length: 100 }, () => ` ${"x".repeat(78)} `);
  const next = success(
    updateStudyCard(original, { areaId, cardId, content: content(parsed(formatTagInput(tags))) }),
  );
  const area = success(updateAreaSettings(original.areas[0], settings(tags)));
  const nextArea = next.areas[0];
  assert.ok(nextArea);
  const nextCard = nextArea.cards[0];
  assert.ok(nextCard);
  assert.deepEqual(nextCard.tags, tags);
  assert.deepEqual(area.tags, tags);
  assert.deepEqual(next.reviewEvents, original.reviewEvents);
  const originalArea = original.areas[0];
  assert.ok(originalArea);
  assert.deepEqual(area.cards, originalArea.cards);
});
