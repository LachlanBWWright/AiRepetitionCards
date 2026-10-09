import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import { Label, Textarea } from "@recall/ui-web";
import { createAreaId, type KnowledgeArea } from "@recall/domain";
import { CardAssistancePanel } from "./CardAssistancePanel";
import { tutorApi } from "@/lib/tutor-api";
const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: createAreaId("go-assistance"),
  title: "Go programming",
  description: null,
  language: "en",
  objectives: [],
  ai: {
    tutorInstructions: "Use precise Go examples.",
    quizInstructions: null,
    cardGenerationInstructions: null,
  },
  cards: [],
  tags: [],
  licence: null,
};
const proposal = {
  front: "Is it always best to copy slices and explain how append works?",
  back: "A slice references an underlying array. Copy elements into a separately allocated slice to obtain independent storage. Append can reuse capacity or allocate a new array.",
  objectiveId: null,
  rationale: "Understand slices and allocation.",
};
const api: typeof tutorApi = {
  request: () => Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" }),
  readSession: () => Effect.succeed(null),
  resolveProposal: () => Effect.void,
};
const meta = {
  title: "Screens/Card Assistance",
  component: CardAssistancePanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="mx-auto min-h-screen max-w-5xl space-y-6 bg-background p-8">
        <div>
          <h1>Go programming</h1>
          <Story />
        </div>
      </main>
    ),
  ],
  args: { proposal, knowledgeArea: area, api, onApply: async (): Promise<boolean> => true },
} satisfies Meta<typeof CardAssistancePanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LocalQuality: Story = {};
export const SplitPreview: Story = {
  args: {
    existingCard: true,
    initialRefinement: {
      cards: [
        {
          front: "Does copying a Go slice descriptor create independent element storage?",
          back: "No. The copy can reference the same backing array; allocate new storage and copy the elements for independence.",
          objectiveId: null,
          rationale: "Test descriptor copying independently.",
          meaningChanged: true,
          sourceReferences: [],
        },
        {
          front: "When can append allocate a new backing array in Go?",
          back: "When the existing capacity cannot accommodate the appended elements.",
          objectiveId: null,
          rationale: "Test capacity independently.",
          meaningChanged: true,
          sourceReferences: [],
        },
      ],
    },
  },
};
export const AiQuality: Story = {
  args: {
    initialInspection: {
      summary:
        "Split the two retrieval tasks and replace the absolute comparison with a precise question.",
      findings: [
        {
          kind: "multiple-facts",
          severity: "warning",
          explanation: "The question asks about copying and append allocation together.",
          suggestion: "Use one card for storage independence and another for append capacity.",
        },
        {
          kind: "ambiguity",
          severity: "warning",
          explanation: "Best depends on whether independent storage is required.",
          suggestion: "Ask whether the copied descriptor shares storage.",
        },
      ],
    },
  },
};
export const Offline: Story = { args: { networkDisabled: true } };

export const DuplicateRefinement: Story = {
  args: {
    initialRefinement: {
      cards: [
        {
          front: "What does a Go channel do?",
          back: "It passes values between goroutines.",
          objectiveId: null,
          rationale: "Test communication.",
          meaningChanged: true,
          sourceReferences: [],
        },
      ],
    },
    duplicateCandidates: [
      {
        id: "existing-go-channel",
        areaTitle: "Go",
        front: "What does a Go channel do?",
        back: "It passes values between goroutines.",
      },
    ],
  },
};
export const RefinementSaveFailure: Story = {
  ...SplitPreview,
  args: { ...SplitPreview.args, onApply: async () => false },
};

export const EditedRefinementBaseline: Story = {
  ...SplitPreview,
  render: function EditedBaseline(args) {
    const [draft, setDraft] = useState(args.proposal);
    return (
      <>
        <Label>
          Original question
          <Textarea
            value={draft.front}
            onChange={(event) => setDraft({ ...draft, front: event.target.value })}
          />
        </Label>
        <CardAssistancePanel {...args} proposal={draft} />
      </>
    );
  },
};
