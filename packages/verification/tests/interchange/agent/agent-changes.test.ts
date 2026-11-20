import { createObjectiveId } from "@recall/domain";
import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  agentDeckRevision,
  applyWorkspaceAuthoringCommand,
  planAgentChanges,
  type AgentProposal,
} from "@recall/application";
import { workspace, deck, card, now, proposal, update } from "./fixtures";

const apply = (value: AgentProposal, source = workspace) =>
  Effect.runPromise(
    Effect.either(
      applyWorkspaceAuthoringCommand(source, { kind: "apply-agent-changes", proposal: value }, now),
    ),
  );
await test("preview is pure; approved edits preserve schedules and append-only reviews and capture versions", async () => {
  const before = JSON.stringify(workspace);
  const planned = await Effect.runPromise(planAgentChanges(workspace, proposal()));
  assert.equal(planned.preview.length, 1);
  assert.match(planned.preview[0]?.before ?? "", /What is borrowing/);
  assert.match(planned.preview[0]?.after ?? "", /borrowing allow/);
  assert.equal(JSON.stringify(workspace), before);
  const result = await apply(proposal());
  assert.ok(Either.isRight(result));
  assert.equal(result.right.workspace.areas[0]?.cards[0]?.front, update.front);
  assert.deepEqual(result.right.workspace.areas[0].cards[0].schedule, card.schedule);
  assert.deepEqual(result.right.workspace.reviewEvents, workspace.reviewEvents);
  assert.equal(result.right.workspace.cardVersions?.length, 1);
});
await test("stale deck content is rejected at application time but new reviews and scheduling do not stale it", async () => {
  const stale = { ...workspace, areas: [{ ...deck, title: "Updated" }] };
  assert.ok(Either.isLeft(await apply(proposal(), stale)));
  const reviewed = {
    ...workspace,
    reviews: 2,
    areas: [
      {
        ...deck,
        cards: deck.cards.map((card) => ({ ...card, schedule: { ...card.schedule, reps: 10 } })),
      },
    ],
  };
  assert.equal(
    agentDeckRevision({ ...deck, cards: reviewed.areas[0]?.cards ?? [] }),
    agentDeckRevision(deck),
  );
  assert.ok(Either.isRight(await apply(proposal(), reviewed)));
});
await test("new deck and cards receive app-derived IDs, can reference a new deck key, and cannot replay", async () => {
  const value = proposal([
    { op: "create-deck", key: "new:deck", title: "Ownership", color: "#abcdef" },
    {
      op: "create-card",
      key: "new:card",
      deckId: "new:deck",
      front: "What is a move?",
      back: "A transfer of ownership.",
      explanation: "",
      tags: [],
    },
  ]);
  const result = await apply(value);
  assert.ok(Either.isRight(result));
  const created = result.right.workspace.areas[1];
  assert.ok(created && created.id !== "new:deck");
  assert.equal(created.cards.length, 1);
  assert.notEqual(created.cards[0]?.id, "new:card");
  assert.equal(created.cards[0]?.schedule.reps, 0);
  assert.ok(Either.isLeft(await apply(value, result.right.workspace)));
});
await test("deletions retain review evidence and never infer deletion from omission", async () => {
  const result = await apply(proposal([{ op: "delete-card", deckId: deck.id, cardId: card.id }]));
  assert.ok(Either.isRight(result));
  assert.equal(result.right.workspace.areas[0]?.cards.length, 0);
  assert.deepEqual(result.right.workspace.reviewEvents, workspace.reviewEvents);
  const removedDeck = await apply(proposal([{ op: "delete-deck", deckId: deck.id }]));
  assert.ok(Either.isRight(removedDeck));
  assert.equal(removedDeck.right.workspace.areas.length, 0);
  assert.deepEqual(removedDeck.right.workspace.reviewEvents, workspace.reviewEvents);
});
await test("unknown targets, duplicate edits, deletion/edit conflicts and structured-card edits are rejected", async () => {
  const cases = [
    proposal([{ ...update, deckId: "missing" }]),
    proposal([{ ...update, cardId: "missing" }]),
    proposal([update, update]),
    proposal([update, { op: "delete-deck", deckId: deck.id }]),
    { ...proposal(), decks: [] },
  ];
  for (const value of cases) assert.ok(Either.isLeft(await apply(value)));
  const linked = {
    ...workspace,
    areas: [{ ...deck, cards: deck.cards.map((card) => ({ ...card, noteId: "linked-note" })) }],
  };
  const value = {
    ...proposal(),
    decks: [
      {
        id: deck.id,
        revision: agentDeckRevision({ ...deck, cards: linked.areas[0]?.cards ?? [] }),
      },
    ],
  };
  assert.ok(Either.isLeft(await apply(value, linked)));
});
await test("an invalid later operation leaves the entire original workspace untouched", async () => {
  const before = JSON.stringify(workspace);
  const result = await apply(
    proposal([
      update,
      {
        op: "create-card",
        key: "empty-card",
        deckId: deck.id,
        front: " ",
        back: " ",
        explanation: "",
        tags: [],
      },
    ]),
  );
  assert.ok(Either.isLeft(result));
  assert.equal(JSON.stringify(workspace), before);
});

await test("external text edits preserve legacy objective labels even when deck objectives exist", async () => {
  const area = {
    ...deck,
    objectives: [
      {
        id: createObjectiveId("lifetimes"),
        title: "Lifetimes",
        description: null,
        prerequisiteIds: [],
      },
    ],
  };
  const source = { ...workspace, areas: [area] };
  const value = { ...proposal(), decks: [{ id: area.id, revision: agentDeckRevision(area) }] };
  const result = await apply(value, source);
  assert.ok(Either.isRight(result));
  const edited = result.right.workspace.areas[0]?.cards[0];
  assert.ok(edited);
  assert.equal(edited.objective, card.objective);
  assert.equal(edited.objectiveIds, undefined);
});
