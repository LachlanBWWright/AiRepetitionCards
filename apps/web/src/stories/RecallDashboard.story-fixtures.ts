import { createObjectiveId } from "@recall/domain";
import { mockWorkspace } from "../features/workspace/mock-data";

const cellStructuresId = createObjectiveId("story-cell-structures");
export const authoredWorkspace = {
  ...mockWorkspace,
  areas: mockWorkspace.areas.map((area, index) =>
    index === 0
      ? {
          ...area,
          objectives: [
            {
              id: cellStructuresId,
              title: "Cell structures",
              description: "Explain how organelles support the cell.",
              prerequisiteIds: [],
            },
          ],
          ai: {
            tutorInstructions: "Use short questions and everyday analogies.",
            quizInstructions: null,
            cardGenerationInstructions: "Keep each proposed card focused on one idea.",
          },
          cards: area.cards.map((card) => ({
            ...card,
            objectiveIds: [cellStructuresId],
            tags: ["biology", "exam"],
          })),
        }
      : area,
  ),
};
