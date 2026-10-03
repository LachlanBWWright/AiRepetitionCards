import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { JSX } from "react";
import { Effect } from "effect";
import { createTutorApi, createTutorPrivacyApi, tutorApiFailureMessage } from "@recall/application";
import { TutorPanel } from "./TutorPanel";
import type { AreaId, CardId, KnowledgeArea, LearningArea, ObjectiveId } from "@recall/domain";
import { createObjectiveId } from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import {
  identifyObjectiveGaps,
  type AnswerEvaluation,
  type CardProposal,
  type TutorHistoryMessage,
} from "@recall/ai-core";

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

const onApprove = async (proposal: CardProposal) => proposal;
const importedArea: LearningArea = {
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
      sessionId: "bcb3aeb4-91be-4c65-bcb6-2e52041a6824",
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

export const ImportedObjectiveGaps: Story = {
  name: "Tutor · imported objective gaps",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    objectiveGaps: identifyObjectiveGaps(importedArea, [], new Date("2026-10-03T09:00:00.000Z")),
    initialState: {
      message:
        "Practice targets your copy's objectives while preserving their upstream provenance.",
    },
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

const weakQuizEvaluation: AnswerEvaluation = {
  result: "incorrect",
  confidence: 0.92,
  feedback:
    "Mitochondria produce ATP. DNA stores genetic information rather than powering cell processes.",
  misconception: "Confuses ATP with DNA.",
  objectiveId: "objective-cell-structures",
  suggestedAction: "propose-card",
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
              ? `Practice answer ${index / 2 + 1}: membranes regulate entry and exit.`
              : "That is correct. Explain how selective permeability supports cell function.",
      })),
      observations: [weakQuizEvaluation],
      message: "Your session continues with recent conversation and saved quiz evidence.",
    },
  },
};

export const LargeAreaContext: Story = {
  name: "Tutor · 500-card context selection",
  args: {
    knowledgeArea: {
      ...knowledgeArea,
      cards: Array.from({ length: 500 }, (_, index) => ({
        kind: "basic" as const,
        id: `large-area-card-${String(index).padStart(3, "0")}` as CardId,
        front: `Cell biology practice ${index + 1}: explain selective permeability.`,
        back: "The cell membrane controls transport through its lipid bilayer and specific proteins. ".repeat(
          8,
        ),
        objectiveIds: ["objective-cell-structures" as ObjectiveId],
        tags: [],
        origin: "authored" as const,
      })),
    },
    onApprove,
    demo: true,
    initialState: {
      history: [
        { role: "assistant", content: "How does selective permeability support cell function?" },
      ],
      message:
        "A bounded selection keeps this 500-card learning area available for tutor practice. Hosted mode requires its latest content to be synchronized first.",
    },
  },
};

export const ApprovalStorageFailure: Story = {
  name: "Tutor · approval storage failure",
  args: {
    ...ReviewCardProposal.args,
    onApprove: async () => null,
    initialState: {
      ...ReviewCardProposal.args?.initialState,
      message: "The card could not be saved locally. Your proposal is still available to retry.",
    },
  },
};
export const ApprovalRetry: Story = {
  name: "Tutor · approval retry",
  args: {
    ...ReviewCardProposal.args,
    initialState: {
      ...ReviewCardProposal.args?.initialState,
      approvalSaved: true,
      message:
        "Your card is saved locally. Retry approval to confirm it; another card will not be created.",
    },
  },
};

const budgetPrivacyApi = createTutorPrivacyApi((request) =>
  Effect.succeed({
    status: 200,
    body:
      request.method === "GET"
        ? { schemaVersion: 1, retentionDays: 30, deletionAvailable: true }
        : { schemaVersion: 1, deleted: true, deletedSessions: 0 },
  }),
);

function hostedBudgetState(status: 429 | 503, message: string, namespace: string) {
  const api = createTutorApi((request) =>
    Effect.succeed(
      request.method === "GET"
        ? { status: 404, body: { error: "session-not-found" } }
        : { status, body: { error: message } },
    ),
  );
  const displayedMessage = Effect.runSync(
    api.request({ action: "question", context: { knowledgeArea, history: [] } }).pipe(
      Effect.match({
        onFailure: tutorApiFailureMessage,
        onSuccess: () => "",
      }),
    ),
  );
  return {
    knowledgeArea,
    onApprove,
    api,
    privacyApi: budgetPrivacyApi,
    sessionNamespace: namespace,
    initialState: {
      history: [
        {
          role: "assistant" as const,
          content: "What molecule do mitochondria produce for cellular work?",
        },
        { role: "learner" as const, content: "ATP, which powers cell processes." },
      ],
      message: displayedMessage,
    },
  };
}

export const HostedDailyTokenBudgetExhausted: Story = {
  name: "Tutor · hosted daily token budget exhausted",
  args: hostedBudgetState(
    429,
    "You have reached today’s hosted AI budget. Try again tomorrow.",
    "storybook-hosted-budget-exhausted",
  ),
};

export const HostedBudgetStorageUnavailable: Story = {
  name: "Tutor · hosted budget storage unavailable",
  args: hostedBudgetState(
    503,
    "Hosted AI budgeting is temporarily unavailable. Try again later.",
    "storybook-hosted-budget-unavailable",
  ),
};

const correctedObjective = {
  id: createObjectiveId("objective-energy-transfer"),
  title: "Cellular energy transfer",
  description: "Explain ATP's role in cellular work.",
  prerequisiteIds: [],
};
export const ProposalObjectiveCorrection: Story = {
  name: "Tutor · corrected proposal objective",
  args: {
    ...ReviewCardProposal.args,
    knowledgeArea: {
      ...knowledgeArea,
      objectives: [...knowledgeArea.objectives, correctedObjective],
    },
    initialState: {
      ...ReviewCardProposal.args?.initialState,
      proposal: {
        front: "What molecule carries energy for cellular processes?",
        back: "ATP transfers readily available energy to cellular processes.",
        objectiveId: correctedObjective.id,
        rationale: "The learner linked this card to energy transfer before approving it.",
      },
    },
  },
};
export const ProposalUnavailableObjective: Story = {
  name: "Tutor · unavailable proposal objective",
  args: {
    ...ReviewCardProposal.args,
    initialState: {
      ...ReviewCardProposal.args?.initialState,
      proposal: {
        front: "What molecule do mitochondria produce?",
        back: "ATP.",
        objectiveId: "objective-no-longer-available",
        rationale: "Review and correct the learning objective before approval.",
      },
      message:
        "Write a question, answer and rationale within the field limits, and choose an objective from this area.",
    },
  },
};

const draftQuiz = {
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
export const MultipleQuizDrafts: Story = {
  name: "Tutor · multiple quiz answer drafts",
  args: {
    knowledgeArea,
    onApprove,
    demo: true,
    initialState: { sessionId: "bcb3aeb4-91be-4c65-bcb6-2e52041a6824", quiz: draftQuiz },
  },
};
export const PreservedQuizDraftAfterEvaluation: Story = {
  name: "Tutor · next answer draft retained after evaluation",
  args: {
    ...MultipleQuizDrafts.args,
    initialState: {
      sessionId: "bcb3aeb4-91be-4c65-bcb6-2e52041a6824",
      evaluation: {
        ...weakQuizEvaluation,
        result: "mastered",
        feedback: "Correct: mitochondria produce ATP.",
        misconception: null,
        suggestedAction: "none",
      },
      quiz: {
        ...draftQuiz,
        questions: draftQuiz.questions.map((question, index) =>
          index === 0
            ? {
                ...question,
                evaluation: {
                  ...weakQuizEvaluation,
                  result: "mastered",
                  feedback: "Correct: mitochondria produce ATP.",
                  misconception: null,
                  suggestedAction: "none",
                },
              }
            : question,
        ),
      },
    },
  },
};

function limitedTutorState(status: 429 | 503, code: string, retryAfterSeconds: number) {
  const api = createTutorApi((request) =>
    Effect.succeed(
      request.method === "GET"
        ? { status: 404, body: { error: "session-not-found" } }
        : { status, body: { error: code, retryAfterSeconds } },
    ),
  );
  const message = Effect.runSync(
    api
      .request({
        action: "question",
        context: { knowledgeArea, history: [] },
      })
      .pipe(Effect.match({ onFailure: tutorApiFailureMessage, onSuccess: () => "" })),
  );
  return {
    ...ReviewCardProposal.args,
    demo: false,
    api,
    privacyApi: budgetPrivacyApi,
    sessionNamespace: `storybook-${code}`,
    initialState: {
      ...ReviewCardProposal.args?.initialState,
      answer: "ATP supplies energy for cellular movement and transport.",
      message,
    },
  };
}
export const RateLimited: Story = {
  name: "Tutor · request throttled preserves draft",
  args: limitedTutorState(429, "rate-limited", 45),
};
export const RateLimitStorageUnavailable: Story = {
  name: "Tutor · limiter unavailable preserves draft",
  args: limitedTutorState(503, "rate-limit-unavailable", 60),
};
