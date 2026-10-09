import assert from "node:assert/strict";
import { Effect, Either } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type KnowledgeArea,
  type Workspace,
} from "@recall/domain";
import { seedKnowledgeNotebook, type KnowledgeNotebook } from "@recall/application";
import { newSchedule } from "@recall/scheduler";

export const uuid = (number: number): string =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const areaId = createAreaId(uuid(1));
export const cardId = createAssessmentId(uuid(2));
export const conceptId = createObjectiveId(uuid(3));
export function knowledgeArea(): KnowledgeArea {
  return {
    schemaVersion: "1.0.0",
    id: areaId,
    title: "Golang library",
    description: "Channel reference",
    language: "en",
    objectives: [
      {
        id: conceptId,
        title: "Channel objective",
        description: "Concurrency prerequisite",
        prerequisiteIds: [],
      },
    ],
    ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
    cards: [
      {
        kind: "basic",
        id: cardId,
        front: "Channel question",
        back: "Channel answer",
        objectiveIds: [conceptId],
        tags: ["goroutines"],
        origin: "authored",
      },
    ],
    tags: ["golang"],
    licence: null,
    attribution: null,
  };
}
export function searchFixture(): {
  readonly workspace: Workspace;
  readonly notebook: KnowledgeNotebook;
} {
  const result = Effect.runSync(
    Effect.either(seedKnowledgeNotebook(knowledgeArea(), "Understand concurrency")),
  );
  assert.ok(Either.isRight(result));
  const materialId = uuid(4),
    sectionId = uuid(5);
  const proposal = {
    front: "Channel suggestion",
    back: "Channel proposal answer",
    objectiveId: conceptId,
    rationale: "Channel rationale",
  };
  return {
    workspace: {
      schemaVersion: 1,
      reviews: 0,
      areas: [
        {
          id: areaId,
          title: "Channel area",
          color: "#112233",
          description: "Concurrency reference",
          tags: ["golang"],
          objectives: knowledgeArea().objectives,
          cards: [
            {
              id: cardId,
              front: "Channel question",
              back: "Channel answer",
              objective: "Concurrency",
              objectiveIds: [conceptId],
              tags: ["goroutines"],
              schedule: newSchedule(new Date("2026-10-01T00:00:00Z")),
            },
          ],
        },
      ],
    },
    notebook: {
      ...result.right,
      materials: [
        {
          id: materialId,
          name: "Channel material",
          format: "paste",
          importedAt: 1,
          warnings: [],
          sections: [
            {
              id: sectionId,
              title: "Channel passage",
              text: "Channel source quote",
              pageNumber: 2,
              selected: true,
            },
          ],
        },
      ],
      coveragePlans: [
        {
          id: uuid(6),
          materialId,
          sectionId,
          createdAt: 1,
          claims: [
            {
              id: uuid(7),
              title: "Channel claim",
              description: "Channel claim description",
              priority: "high",
              decision: "selected",
              sourceReferences: [
                { materialId, sectionId, pageNumber: 2, quote: "Channel source quote" },
              ],
            },
          ],
        },
      ],
      evidence: [
        {
          kind: "tutor",
          id: uuid(8),
          conceptId,
          question: "Channel conversation",
          answer: "Channel learner answer",
          learnerConfidence: "unsure",
          evaluation: {
            result: "partial",
            confidence: 0.7,
            feedback: "Channel feedback",
            misconception: "Channel misconception",
            objectiveId: conceptId,
            suggestedAction: "propose-card",
          },
          at: 1,
          linkedCardIds: [],
        },
      ],
      proposals: [
        {
          id: uuid(9),
          conceptId,
          evidenceIds: [uuid(8)],
          proposal,
          createdAt: 1,
          status: "pending",
          cardId: null,
        },
      ],
    },
  };
}
