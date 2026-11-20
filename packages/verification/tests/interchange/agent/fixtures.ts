import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type Workspace,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { agentDeckRevision, type AgentOperation, type AgentProposal } from "@recall/application";

export const now = new Date("2026-11-06T12:00:00Z");
export const card = {
  id: createAssessmentId("borrowing"),
  front: "What is borrowing?",
  back: "Temporary access without moving ownership.",
  explanation: "Original explanation",
  objective: "Ownership",
  tags: ["rust"],
  schedule: newSchedule(now),
};
export const deck = {
  id: createAreaId("rust"),
  title: "Rust",
  color: "#123456",
  cards: [card],
};
export const workspace: Workspace = {
  schemaVersion: 1,
  reviews: 1,
  areas: [deck],
  reviewEvents: [
    {
      id: createReviewEventId("review1"),
      areaId: deck.id,
      cardId: card.id,
      ratedAt: now.toISOString(),
      rating: "again",
      schedulerFamily: "fsrs",
      schedulerVersion: "1",
    },
  ],
};
export const update = {
  op: "update-card",
  deckId: deck.id,
  cardId: card.id,
  front: "What does borrowing allow in Rust?",
  back: "Access to a value without transferring ownership.",
  explanation: "A reference borrows its referent.",
  tags: ["rust", "ownership"],
} as const;
export function proposal(operations: readonly AgentOperation[] = [update]): AgentProposal {
  return {
    format: "recall-agent-changes",
    version: 1,
    handoverId: "handover-one",
    decks: [{ id: deck.id, revision: agentDeckRevision(deck) }],
    operations,
  };
}
