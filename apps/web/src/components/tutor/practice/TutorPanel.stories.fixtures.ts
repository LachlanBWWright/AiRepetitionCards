import type {
  AreaId,
  AssessmentId,
  KnowledgeArea,
  LearningArea,
  ObjectiveId,
} from "@recall/domain";
import { createObjectiveId } from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import type { AnswerEvaluation, CardProposal } from "@recall/ai-core";

export const knowledgeArea: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: "storybook-cell-biology" as AreaId,
  title: "Cell biology",
  description: "A compact guide to core cell structures.",
  language: "en",
  objectives: [
    {
      id: "objective-cell-structures" as ObjectiveId,
      title: "Cell structures",
      description: null,
      prerequisiteIds: [],
    },
  ],
  ai: {
    tutorInstructions: "Use short explanations and ask one question at a time.",
    quizInstructions: null,
    cardGenerationInstructions: null,
  },
  cards: [
    {
      kind: "basic",
      id: "mitochondria-card" as AssessmentId,
      front: "What is the main role of mitochondria?",
      back: "They produce ATP through cellular respiration.",
      objectiveIds: ["objective-cell-structures" as ObjectiveId],
      tags: ["organelles"],
      origin: "authored",
    },
  ],
  tags: ["biology"],
  licence: null,
};

export const onApprove = (proposal: CardProposal) => Promise.resolve(proposal);
export const importedArea: LearningArea = {
  id: knowledgeArea.id,
  title: knowledgeArea.title,
  color: "#c4ed68",
  objectives: knowledgeArea.objectives.map((objective) => ({
    ...objective,
    sourceId: `upstream:${objective.id}`,
  })),
  cards: knowledgeArea.cards.flatMap((card) =>
    card.kind === "basic"
      ? [
          {
            ...card,
            objective: "Cell structures",
            sourceId: `upstream:${card.id}`,
            schedule: newSchedule(new Date("2026-10-01T09:00:00.000Z")),
          },
        ]
      : [],
  ),
};

export const weakObjective = {
  objectiveId: "objective-cell-structures",
  objectiveTitle: "Cell structures",
  kind: "retention-risk" as const,
  severity: "high" as const,
  cardCount: 3,
  dueCardCount: 2,
  recentFailureCount: 2,
  evidenceSummary: "2 of the last 5 reviews were rated Again.",
};

export const weakQuizEvaluation: AnswerEvaluation = {
  result: "incorrect",
  confidence: 0.92,
  feedback:
    "Mitochondria produce ATP. DNA stores genetic information rather than powering cell processes.",
  misconception: "Confuses ATP with DNA.",
  objectiveId: "objective-cell-structures",
  suggestedAction: "propose-card",
};

export const draftQuiz = {
  objectiveId: "objective-cell-structures",
  objectiveTitle: "Cell structures",
  questions: [
    {
      prompt: "What molecule do mitochondria produce?",
      expectedAnswer: "ATP.",
      learnerAnswer: "Mitochondria make ATP.",
      evaluation: null,
    },
    {
      prompt: "How do cells use ATP?",
      expectedAnswer: "It transfers energy to cellular processes.",
      learnerAnswer:
        "ATP provides energy for movement and transport. This draft stays while the first answer is checked.",
      evaluation: null,
    },
  ],
};

export const correctedObjective = {
  id: createObjectiveId("objective-energy-transfer"),
  title: "Cellular energy transfer",
  description: "Explain ATP's role in cellular work.",
  prerequisiteIds: [],
};
