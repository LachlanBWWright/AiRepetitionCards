import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import {
  seedKnowledgeNotebook,
  type KnowledgeNotebook,
  type NotebookEvidence,
} from "@recall/application";
import { createAreaId, createCardId, createObjectiveId, type KnowledgeArea } from "@recall/domain";
import { cardIdForTutorProposal, type CardProposal, type TutorQuestion } from "@recall/ai-core";
import { KnowledgeNotebookPanel } from "./KnowledgeNotebookPanel";
import { tutorApi } from "@/lib/tutor-api";

const now = Date.parse("2026-10-04T09:00:00Z");
const sessionId = "00000000-0000-4000-8000-000000000001";
const proposalId = "00000000-0000-4000-8000-000000000002";
const evidenceId = "00000000-0000-4000-8000-000000000003";
const slices = createObjectiveId("go-slice-aliasing");
const interfaces = createObjectiveId("go-interfaces");
const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: createAreaId("storybook-go"),
  title: "Go programming",
  description: "Read unfamiliar Go code and build reliable web services.",
  language: "en",
  objectives: [
    {
      id: slices,
      title: "Slices and shared backing arrays",
      description: "Understand aliasing and append allocation.",
      prerequisiteIds: [],
    },
    { id: interfaces, title: "Interfaces and method sets", description: null, prerequisiteIds: [] },
  ],
  ai: {
    tutorInstructions: "Use small code examples and ask for reasoning.",
    quizInstructions: null,
    cardGenerationInstructions: null,
  },
  cards: [],
  tags: ["go", "programming"],
  licence: null,
};
const seed = Effect.runSync(
  seedKnowledgeNotebook(
    area,
    "Understand Go slices well enough to diagnose aliasing bugs in a web service.",
  ),
);
const question: TutorQuestion = {
  question: "a := []int{1, 2, 3}\nb := a[:2]\nb[0] = 9\n\nWhat does fmt.Println(a) print, and why?",
  objectiveId: slices,
  teachingIntent: "Distinguish copying a slice descriptor from copying the underlying elements.",
  conceptSuggestions: [
    {
      title: "append and allocation",
      description: "Explore when append reuses capacity and when it allocates a new backing array.",
    },
  ],
};
const evidence: NotebookEvidence = {
  kind: "tutor",
  id: evidenceId,
  conceptId: slices,
  question: question.question,
  answer: "[1 2 3], because assigning a slice makes a copy of its elements.",
  learnerConfidence: "confident",
  investigationMode: "predict",
  at: now - 120_000,
  providerSessionId: sessionId,
  linkedCardIds: [],
  evaluation: {
    result: "incorrect",
    confidence: 0.9,
    objectiveId: slices,
    suggestedAction: "propose-card",
    feedback:
      "It prints [9 2 3]. The descriptors are distinct, but both slices refer to the same backing array.",
    misconception: "Assigning or slicing a slice copies its elements.",
  },
};
const proposal: CardProposal = {
  front: "Why can changing an element through one Go slice affect another slice?",
  back: "Both slices may refer to the same backing array. Copying a slice descriptor does not copy its elements; allocate a destination and use copy when independent elements are needed.",
  objectiveId: slices,
  rationale: "Your code prediction confused descriptor copying with element copying.",
};
const active: KnowledgeNotebook = {
  ...seed,
  session: {
    ...seed.session,
    phase: "active",
    targetConceptId: slices,
    pendingQuestion: question,
    providerSessionId: sessionId,
    mode: "predict",
    askedQuestions: 2,
    requestsUsed: 3,
    startedAt: now - 180_000,
    maxQuestions: 12,
    maxRequests: 40,
    maximumDurationMs: 1_200_000,
  },
};
const gaps: KnowledgeNotebook = {
  ...active,
  evidence: [evidence],
  session: { ...active.session, pendingQuestion: null },
};
const proposals: KnowledgeNotebook = {
  ...gaps,
  proposals: [
    {
      id: proposalId,
      conceptId: slices,
      evidenceIds: [evidenceId],
      proposal,
      createdAt: now,
      providerSessionId: sessionId,
      providerAcknowledged: false,
      status: "pending",
      cardId: null,
    },
  ],
};
const savedCardId = createCardId(cardIdForTutorProposal(proposalId) ?? "storybook-approved-card");
const finished: KnowledgeNotebook = {
  ...proposals,
  evidence: [{ ...evidence, linkedCardIds: [savedCardId] }],
  proposals: proposals.proposals.map((entry) => ({
    ...entry,
    status: "accepted",
    cardId: savedCardId,
    providerAcknowledged: true,
  })),
  session: {
    ...proposals.session,
    phase: "finished",
    pendingQuestion: null,
    targetConceptId: null,
  },
};
const api: typeof tutorApi = {
  readSession: () => Effect.succeed(null),
  resolveProposal: () => Effect.void,
  request: (input) => {
    if (input.action === "question")
      return Effect.succeed({
        action: "question",
        sessionId,
        result: {
          ...question,
          objectiveId: input.context.investigation?.objectiveId ?? slices,
          ...(input.context.investigation?.investigationKind === "explain"
            ? {
                explanation:
                  "A slice contains a pointer, length and capacity. Slicing creates another descriptor pointing into the same array. Element writes therefore remain visible through both views.",
              }
            : {}),
        },
      });
    if (input.action === "evaluate")
      return Effect.succeed({ action: "evaluate", sessionId, result: evidence.evaluation });
    if (input.action === "propose-card")
      return Effect.succeed({ action: "propose-card", sessionId, proposalId, result: proposal });
    return Effect.fail({
      _tag: "TutorApiFailure",
      reason: "http",
      status: 400,
      code: "unsupported-operation",
    });
  },
};
const meta = {
  title: "Screens/Knowledge Notebook",
  component: KnowledgeNotebookPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="component-catalog tutor-story">
        <div>
          <p className="eyebrow">RECALL · GO PROGRAMMING · MOCK DATA</p>
          <h1>Turn uncertain understanding into a useful deck.</h1>
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    knowledgeArea: area,
    demo: true,
    api,
    clock: () => now,
    onApprove: async (card: CardProposal) => card,
    onStartReview: () => undefined,
  },
} satisfies Meta<typeof KnowledgeNotebookPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {
  name: "Notebook · ready to investigate",
  args: { initialNotebook: seed },
};
export const Question: Story = {
  name: "Notebook · code question and confidence",
  args: { initialNotebook: active },
};
export const Gaps: Story = {
  name: "Notebook · misconceptions and evidence",
  args: { initialNotebook: gaps },
};
export const Proposals: Story = {
  name: "Notebook · editable card proposals",
  args: { initialNotebook: proposals },
};
export const Finished: Story = {
  name: "Notebook · finished and ready to review",
  args: { initialNotebook: finished },
};
