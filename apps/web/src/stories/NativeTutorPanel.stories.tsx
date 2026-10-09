import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect, Either, Schema } from "effect";
import { createTutorApi, toKnowledgeArea, tutorApiFailureMessage } from "@recall/application";
import type { TutorHttpRequest } from "@recall/application";
import {
  ResolveTutorProposalRequestSchema,
  TutorApiRequestSchema,
  TutorSessionStateResponseSchema,
} from "@recall/ai-core";
import type { TutorSessionState } from "@recall/ai-core";
import { createAssessmentId, createObjectiveId } from "@recall/domain";
import { mockWorkspace } from "../features/workspace/mock-data";
import { NativeTutorPanel } from "../../../mobile/src/components/NativeTutorPanel";

const storyUuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const learningArea = mockWorkspace.areas.find((area) => area.id === "area-biology");
const portableArea = learningArea
  ? Effect.runSync(Effect.either(toKnowledgeArea(learningArea, true)))
  : null;
const area = portableArea && Either.isRight(portableArea) ? portableArea.right : null;
const sessionId = storyUuid(701);
const proposalId = storyUuid(702);
const objectiveId = area?.objectives[0]?.id ?? null;

const session: TutorSessionState = {
  sessionId,
  history: [
    { role: "learner", content: "Why do cells need mitochondria?" },
    {
      role: "assistant",
      content:
        "They make ATP, the cell's readily usable energy source. When might a cell need more ATP?",
    },
  ],
  evaluation: null,
  proposal: {
    proposalId,
    content: {
      front: "What molecule do mitochondria produce for cellular energy?",
      back: "ATP, which cells use as a readily available energy source.",
      objectiveId,
      rationale: "The learner explained the role but had not yet recalled the molecule.",
    },
  },
  quiz: null,
};

function storyTransport(request: TutorHttpRequest, state: TutorSessionState = session) {
  if (request.method === "POST") {
    const decoded = Schema.decodeUnknownEither(TutorApiRequestSchema)(request.body);
    return Either.isRight(decoded) &&
      decoded.right.request.action === "propose-card" &&
      session.proposal
      ? Effect.succeed({
          status: 200,
          body: {
            schemaVersion: 1,
            response: {
              action: "propose-card",
              sessionId,
              proposalId,
              result: session.proposal.content,
            },
          },
        })
      : Effect.succeed({ status: 400, body: { error: "invalid-request" } });
  }
  if (request.method === "GET") {
    const decoded = Schema.decodeUnknownEither(TutorSessionStateResponseSchema)({
      schemaVersion: 1,
      state,
    });
    return Either.isRight(decoded)
      ? Effect.succeed({ status: 200, body: decoded.right })
      : Effect.fail({ _tag: "TutorTransportError" } as const);
  }
  if (request.method === "PATCH") {
    const decoded = Schema.decodeUnknownEither(ResolveTutorProposalRequestSchema)(request.body);
    return Either.isRight(decoded)
      ? Effect.succeed({
          status: 200,
          body: {
            schemaVersion: 1,
            proposalId: decoded.right.request.proposalId,
            state: decoded.right.request.state,
          },
        })
      : Effect.succeed({ status: 400, body: { error: "invalid-request" } });
  }
  return Effect.fail({ _tag: "TutorTransportError" } as const);
}

const api = createTutorApi(storyTransport);

const meta = {
  title: "Screens/Native AI Tutor",
  component: NativeTutorPanel,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Native tutor proposal review with deterministic session and learner-approved card mock data.",
      },
    },
  },
} satisfies Meta<typeof NativeTutorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProposalApproval: Story = {
  name: "Tutor · proposal approval (native)",
  args: {
    area,
    api,
    createId: () => storyUuid(703),
    initialSessionId: sessionId,
    onSessionIdChange: () => undefined,
    onApproveProposal: async (content) => ({
      cardId: "bda35d66-909f-4e86-99c4-c46f2b074325",
      content,
    }),
  },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  render: (args) => (
    <div style={{ minHeight: 844, padding: 18, backgroundColor: "#faf9f6" }}>
      <NativeTutorPanel {...args} />
    </div>
  ),
};

const weakQuizSession: TutorSessionState = {
  ...session,
  proposal: null,
  evaluation: {
    result: "incorrect",
    confidence: 0.92,
    feedback: "Mitochondria produce ATP. DNA stores genetic information.",
    misconception: "Confuses ATP with DNA.",
    objectiveId,
    suggestedAction: "propose-card",
  },
  quiz: objectiveId
    ? {
        objectiveId,
        objectiveTitle: "Cell structures",
        questions: [
          {
            prompt: "What molecule do mitochondria produce for cellular work?",
            expectedAnswer: "ATP, produced through cellular respiration.",
            learnerAnswer: "DNA",
            evaluation: {
              result: "incorrect",
              confidence: 0.92,
              feedback: "Mitochondria produce ATP. DNA stores genetic information.",
              misconception: "Confuses ATP with DNA.",
              objectiveId,
              suggestedAction: "propose-card",
            },
          },
          {
            prompt: "How do cells use ATP?",
            expectedAnswer: "ATP transfers energy to processes such as transport and movement.",
            learnerAnswer: "It stores genetic instructions.",
            evaluation: {
              result: "incorrect",
              confidence: 0.88,
              feedback: "ATP supplies usable energy; DNA stores genetic instructions.",
              misconception: "Confuses ATP's energy role with DNA's information role.",
              objectiveId,
              suggestedAction: "propose-card",
            },
          },
        ],
      }
    : null,
};

export const QuizCardProposalAction: Story = {
  ...ProposalApproval,
  name: "Tutor · weak quiz result with card action (native)",
  args: {
    ...ProposalApproval.args,
    api: createTutorApi((request) => storyTransport(request, weakQuizSession)),
  },
};

const secondObjectiveId = createObjectiveId("story-gene-expression");
const secondObjectiveArea = area
  ? {
      ...area,
      objectives: [
        ...(area.objectives[0] ? [area.objectives[0]] : []),
        {
          id: secondObjectiveId,
          title: "Gene expression",
          description: "Explain how genes guide protein production.",
          prerequisiteIds: [],
        },
      ],
      cards: [
        ...area.cards.filter((card) =>
          card.objectiveIds.every((id) => id === area.objectives[0]?.id),
        ),
        {
          id: createAssessmentId("story-gene-expression-card"),
          kind: "basic" as const,
          front: "How is a gene used to make a protein?",
          back: "Transcription makes RNA; translation uses that RNA to make protein.",
          objectiveIds: [secondObjectiveId],
          tags: [],
          origin: "authored" as const,
        },
      ],
    }
  : null;
const weakSecondSession: TutorSessionState = {
  ...session,
  evaluation: null,
  proposal: null,
  observations: [
    {
      result: "incorrect",
      confidence: 0.94,
      objectiveId: secondObjectiveId,
      feedback: "Translation reads RNA to build protein; it does not produce DNA.",
      misconception: "Confuses translation with DNA replication.",
      suggestedAction: "targeted-quiz",
    },
  ],
};

export const WeakSecondObjective: Story = {
  name: "Tutor · weak second objective (native)",
  args: {
    ...ProposalApproval.args,
    area: secondObjectiveArea,
    api: createTutorApi((request) => {
      if (request.method !== "POST") return storyTransport(request, weakSecondSession);
      const decoded = Schema.decodeUnknownEither(TutorApiRequestSchema)(request.body);
      if (Either.isLeft(decoded) || decoded.right.request.action !== "targeted-quiz")
        return Effect.succeed({ status: 400, body: { error: "invalid-request" } });
      const target = decoded.right.request.objectiveId;
      return Effect.succeed({
        status: 200,
        body: {
          schemaVersion: 1,
          response: {
            action: "targeted-quiz",
            sessionId,
            result: {
              objectiveId: target,
              objectiveTitle: target === secondObjectiveId ? "Gene expression" : "Cell structures",
              questions: [
                {
                  prompt: "What does translation produce?",
                  expectedAnswer: "A protein made using the RNA sequence.",
                },
                {
                  prompt: "How does transcription support translation?",
                  expectedAnswer: "It produces the RNA sequence that translation reads.",
                },
              ],
            },
          },
        },
      });
    }),
  },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  render: (args) => (
    <div style={{ minHeight: 844, padding: 18, backgroundColor: "#faf9f6" }}>
      <NativeTutorPanel {...args} />
    </div>
  ),
};

const editedProposal = session.proposal
  ? {
      ...session.proposal.content,
      front: "What energy carrier do mitochondria make through cellular respiration?",
      back: "ATP: an energy carrier that powers cellular processes.",
      rationale: "Edited by the learner to connect respiration with cellular work.",
    }
  : null;

export const EditedProposal: Story = {
  ...ProposalApproval,
  name: "Tutor · edited Basic proposal (native)",
  args: {
    ...ProposalApproval.args,
    ...(editedProposal ? { initialProposalDraft: { proposalId, content: editedProposal } } : {}),
  },
};

export const InvalidProposalDraft: Story = {
  ...EditedProposal,
  name: "Tutor · invalid proposal edit (native)",
  args: {
    ...EditedProposal.args,
    ...(editedProposal
      ? { initialProposalDraft: { proposalId, content: { ...editedProposal, front: "" } } }
      : {}),
    initialNotice:
      "Enter a question, answer and rationale within the field limits, and choose an objective from this area.",
  },
};

export const ProposalSaveFailure: Story = {
  ...EditedProposal,
  name: "Tutor · edited proposal save failure (native)",
  args: {
    ...EditedProposal.args,
    onApproveProposal: async () => null,
    initialNotice:
      "The card could not be saved locally, so approval was not sent. Your edits remain available to retry.",
  },
};

const tentativeEvaluation = {
  result: "uncertain" as const,
  confidence: 0.32,
  objectiveId,
  feedback:
    "Your answer mentions energy, but I need more detail to assess how ATP supports cellular work.",
  misconception: null,
  suggestedAction: "explain" as const,
};
const lowConfidenceSession: TutorSessionState = {
  ...session,
  proposal: null,
  evaluation: tentativeEvaluation,
};
export const LowConfidenceEvaluation: Story = {
  ...ProposalApproval,
  name: "Tutor · tentative evaluation (native)",
  args: {
    ...ProposalApproval.args,
    api: createTutorApi((request) => storyTransport(request, lowConfidenceSession)),
  },
};
export const LowConfidenceQuizFeedback: Story = {
  ...ProposalApproval,
  name: "Tutor · tentative completed quiz feedback (native)",
  args: {
    ...ProposalApproval.args,
    api: createTutorApi((request) =>
      storyTransport(request, {
        ...weakQuizSession,
        evaluation: tentativeEvaluation,
        quiz: weakQuizSession.quiz
          ? {
              ...weakQuizSession.quiz,
              questions: weakQuizSession.quiz.questions.map((item) => ({
                ...item,
                learnerAnswer: "It helps with energy.",
                evaluation: tentativeEvaluation,
              })),
            }
          : null,
      }),
    ),
  },
};

function limitedNativeTutorState(status: 429 | 503, code: string, retryAfterSeconds: number) {
  const api = createTutorApi((request) =>
    request.method === "GET"
      ? storyTransport(request)
      : Effect.succeed({ status, body: { error: code, retryAfterSeconds } }),
  );
  const notice = area
    ? Effect.runSync(
        api
          .request({
            action: "question",
            context: { knowledgeArea: area, history: [] },
          })
          .pipe(Effect.match({ onFailure: tutorApiFailureMessage, onSuccess: () => "" })),
      )
    : "";
  return {
    ...ProposalApproval.args,
    api,
    initialAnswer: "ATP supplies energy for cellular movement and transport.",
    initialNotice: notice,
  };
}
export const RateLimited: Story = {
  ...ProposalApproval,
  name: "Tutor · request throttled preserves draft (native)",
  args: limitedNativeTutorState(429, "rate-limited", 45),
};
export const RateLimitStorageUnavailable: Story = {
  ...ProposalApproval,
  name: "Tutor · limiter unavailable preserves draft (native)",
  args: limitedNativeTutorState(503, "rate-limit-unavailable", 60),
};
