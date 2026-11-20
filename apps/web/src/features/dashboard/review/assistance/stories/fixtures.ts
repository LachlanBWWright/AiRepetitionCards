import { Effect } from "effect";
import type { TutorActionResponse } from "@recall/ai-core";
import { createTutorApi, type TutorApiFailure } from "@recall/application";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type Workspace,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
export const now = new Date("2026-10-25T12:00:00Z");
export const original = {
  id: createAssessmentId("repair-card"),
  front: "What do mitochondria and ribosomes do?",
  back: "Mitochondria produce ATP; ribosomes synthesize proteins.",
  objective: "Cell biology",
  schedule: newSchedule(now),
};
export const initial: Workspace = {
  schemaVersion: 1,
  reviews: 1,
  reviewEvents: [
    {
      id: createReviewEventId("original-review"),
      areaId: createAreaId("repair-area"),
      cardId: original.id,
      ratedAt: now.toISOString(),
      rating: "again",
      schedulerFamily: "fsrs",
      schedulerVersion: "1",
    },
  ],
  areas: [
    { id: createAreaId("repair-area"), title: "Cell biology", color: "#123456", cards: [original] },
  ],
};
export const api: ReturnType<typeof createTutorApi> = {
  ...createTutorApi(() => Effect.succeed({ status: 503, body: null })),
  request: (input): Effect.Effect<TutorActionResponse, TutorApiFailure> => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    if (input.action === "question")
      return Effect.succeed({
        action: "question",
        sessionId,
        proposalId: "00000000-0000-4000-8000-000000000002",
        providerResolutionRequired: false,
        result: {
          question:
            "Mitochondria supply `ATP`, while ribosomes assemble proteins from amino acids.",
          teachingIntent: "Explain the two independent functions.",
          objectiveId: null,
        },
      });
    if (input.action === "inspect-card")
      return Effect.succeed({
        action: "inspect-card",
        sessionId,
        result: {
          summary: "This card asks about two independently recallable facts.",
          findings: [],
        },
      });
    if (input.action === "refine-card")
      return Effect.succeed({
        action: "refine-card",
        sessionId,
        result: {
          cards: [
            {
              front: "What do mitochondria produce?",
              back: "ATP through cellular respiration.",
              objectiveId: null,
              rationale: "Recall one function at a time.",
              meaningChanged: false,
              sourceReferences: [],
            },
            {
              front: "What do ribosomes synthesize?",
              back: "Proteins.",
              objectiveId: null,
              rationale: "Separate the second independent fact.",
              meaningChanged: false,
              sourceReferences: [],
            },
          ],
        },
      });
    return Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" });
  },
};
