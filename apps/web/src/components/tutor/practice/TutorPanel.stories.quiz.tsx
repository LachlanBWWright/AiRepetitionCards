import type { Story } from "./TutorPanel.stories";
import type { TutorHistoryMessage } from "@recall/ai-core";
import {
  knowledgeArea,
  onApprove,
  weakObjective,
  weakQuizEvaluation,
} from "./TutorPanel.stories.fixtures";

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

export const QuizCardProposalAction: Story = {
  name: "Tutor · weak quiz result with card action",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    initialState: {
      sessionId: "bcb3aeb4-91be-4c65-bcb6-2e52041a6824",
      evaluation: weakQuizEvaluation,
      quiz: {
        objectiveId: "objective-cell-structures",
        objectiveTitle: "Cell structures",
        questions: [
          {
            prompt: "What molecule do mitochondria produce for cellular work?",
            expectedAnswer: "ATP, produced through cellular respiration.",
            learnerAnswer: "DNA",
            evaluation: weakQuizEvaluation,
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

export const RetainedQuizEvidence: Story = {
  name: "Tutor · accumulated quiz evidence",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    initialState: {
      sessionId: "bcb3aeb4-91be-4c65-bcb6-2e52041a6824",
      evaluation: {
        result: "mastered",
        confidence: 0.94,
        feedback: "Correct. The membrane regulates what enters and leaves a cell.",
        misconception: null,
        objectiveId: "objective-cell-structures",
        suggestedAction: "none",
      },
      quiz: {
        objectiveId: "objective-cell-structures",
        objectiveTitle: "Cell structures",
        questions: [
          {
            prompt: "What molecule do mitochondria produce for cellular work?",
            expectedAnswer: "ATP, produced through cellular respiration.",
            learnerAnswer: "DNA",
            evaluation: weakQuizEvaluation,
          },
          {
            prompt: "What does the cell membrane control?",
            expectedAnswer: "Movement of substances into and out of the cell.",
            learnerAnswer: "What enters and leaves the cell.",
            evaluation: {
              result: "mastered",
              confidence: 0.94,
              feedback: "Correct. The membrane regulates what enters and leaves a cell.",
              misconception: null,
              objectiveId: "objective-cell-structures",
              suggestedAction: "none",
            },
          },
        ],
      },
    },
  },
};

export const RestoredSessionEvidence: Story = {
  name: "Tutor · restored session evidence",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    initialState: {
      sessionId: "bcb3aeb4-91be-4c65-bcb6-2e52041a6824",
      observations: [weakQuizEvaluation],
      history: [{ role: "assistant", content: "How does the cell membrane regulate transport?" }],
      evaluation: null,
      quiz: null,
    },
  },
};

export const LongSessionWindow: Story = {
  name: "Tutor · long session context window",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    initialState: {
      sessionId: "bcb3aeb4-91be-4c65-bcb6-2e52041a6824",
      history: Array.from({ length: 80 }, (_, index): TutorHistoryMessage => ({
        role: index % 2 === 0 ? "learner" : "assistant",
        content:
          index === 79
            ? "How do transport proteins help the membrane regulate movement?"
            : index % 2 === 0
              ? `Practice answer ${String(index / 2 + 1)}: membranes regulate entry and exit.`
              : "That is correct. Explain how selective permeability supports cell function.",
      })),
      observations: [weakQuizEvaluation],
      message: "Your session continues with recent conversation and saved quiz evidence.",
    },
  },
};
