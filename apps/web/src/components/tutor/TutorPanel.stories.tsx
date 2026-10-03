import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { JSX } from "react";
import { TutorPanel } from "./TutorPanel";
import type { AreaId, CardId, KnowledgeArea, ObjectiveId } from "@recall/domain";

const knowledgeArea: KnowledgeArea = {
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
      id: "mitochondria-card" as CardId,
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

const onApprove = () => undefined;
const weakObjective = {
  objectiveId: "objective-cell-structures",
  objectiveTitle: "Cell structures",
  kind: "retention-risk" as const,
  severity: "high" as const,
  cardCount: 3,
  dueCardCount: 2,
  recentFailureCount: 2,
  evidenceSummary: "2 of the last 5 reviews were rated Again.",
};
const meta = {
  title: "Screens/AI Tutor",
  component: TutorPanel,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Full-screen tutor states with deterministic mock learning content and explicit card approval.",
      },
    },
  },
  decorators: [
    (Story: () => JSX.Element) => (
      <main className="component-catalog tutor-story">
        <div>
          <p className="eyebrow">RECALL · CELL BIOLOGY</p>
          <h1>Learn through a conversation.</h1>
          <p>AI feedback stays evidence-based, and proposed cards wait for your approval.</p>
          <Story />
        </div>
      </main>
    ),
  ],
} satisfies Meta<typeof TutorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Start: Story = {
  name: "Tutor · start",
  args: { knowledgeArea, onApprove, demo: true },
};

export const AnswerFeedback: Story = {
  name: "Tutor · answer feedback",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    initialState: {
      history: [
        { role: "assistant", content: "What does the mitochondrion provide for a cell?" },
        { role: "learner", content: "It makes energy the cell can use." },
        {
          role: "assistant",
          content:
            "Right. More precisely, mitochondria produce ATP, which cells use to power many processes.",
        },
      ],
      evaluation: {
        result: "partial",
        confidence: 0.86,
        feedback: "You have the central idea. Naming ATP makes the answer more precise.",
        misconception: null,
        objectiveId: "objective-cell-structures",
        suggestedAction: "propose-card",
      },
    },
  },
};

export const ReviewCardProposal: Story = {
  name: "Tutor · card proposal",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    initialState: {
      proposalId: "f82fd14a-3766-498c-8bcb-7114859258da",
      history: [
        { role: "assistant", content: "What does the mitochondrion provide for a cell?" },
        { role: "learner", content: "It makes energy the cell can use." },
        {
          role: "assistant",
          content: "Good start. Let's make the exact molecule easier to remember.",
        },
      ],
      evaluation: {
        result: "partial",
        confidence: 0.86,
        feedback: "Naming ATP will make this answer more precise.",
        misconception: null,
        objectiveId: "objective-cell-structures",
        suggestedAction: "propose-card",
      },
      proposal: {
        front: "What molecule do mitochondria produce to power cell processes?",
        back: "ATP (adenosine triphosphate).",
        objectiveId: "objective-cell-structures",
        rationale: "Targets the missing detail in the learner's answer.",
      },
    },
  },
};

export const ObjectiveGaps: Story = {
  name: "Tutor · objective gaps",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    objectiveGaps: [weakObjective],
  },
};

export const TargetedQuiz: Story = {
  name: "Tutor · targeted quiz",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    objectiveGaps: [weakObjective],
    initialState: {
      quiz: {
        objectiveId: "objective-cell-structures",
        objectiveTitle: "Cell structures",
        questions: [
          {
            prompt: "What molecule do mitochondria produce for cellular work?",
            expectedAnswer: "ATP, produced through cellular respiration.",
            learnerAnswer: null,
            evaluation: null,
          },
          {
            prompt: "Where does transcription occur in a eukaryotic cell?",
            expectedAnswer: "In the nucleus, where DNA is transcribed into RNA.",
            learnerAnswer: null,
            evaluation: null,
          },
          {
            prompt: "What does the cell membrane control?",
            expectedAnswer: "The movement of substances into and out of the cell.",
            learnerAnswer: null,
            evaluation: null,
          },
        ],
      },
    },
  },
};

export const TargetedQuizFeedback: Story = {
  name: "Tutor · targeted quiz feedback",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    objectiveGaps: [weakObjective],
    initialState: {
      quiz: {
        objectiveId: "objective-cell-structures",
        objectiveTitle: "Cell structures",
        questions: [
          {
            prompt: "What molecule do mitochondria produce for cellular work?",
            expectedAnswer: "ATP, produced through cellular respiration.",
            learnerAnswer: "ATP",
            evaluation: {
              result: "partial",
              confidence: 0.93,
              feedback:
                "Good recall. Add how cellular respiration makes ATP for a complete answer.",
              misconception: null,
              objectiveId: "objective-cell-structures",
              suggestedAction: "explain",
            },
          },
          {
            prompt: "Where does transcription occur in a eukaryotic cell?",
            expectedAnswer: "In the nucleus, where DNA is transcribed into RNA.",
            learnerAnswer: null,
            evaluation: null,
          },
          {
            prompt: "What does the cell membrane control?",
            expectedAnswer: "The movement of substances into and out of the cell.",
            learnerAnswer: null,
            evaluation: null,
          },
        ],
      },
    },
  },
};

export const DailyTutorLimit: Story = {
  name: "Tutor · daily limit reached",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    initialState: {
      history: [
        { role: "assistant", content: "What does the mitochondrion provide for a cell?" },
        { role: "learner", content: "ATP, which powers cell processes." },
      ],
      message: "You've reached today's tutor limit. Try again tomorrow.",
    },
  },
};
