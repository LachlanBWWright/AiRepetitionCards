import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import {
  addNotebookMaterial,
  addMaterialCardProposals,
  seedKnowledgeNotebook,
  type KnowledgeNotebook,
  type StudyMaterial,
} from "@recall/application";
import { createAreaId, createObjectiveId, type KnowledgeArea } from "@recall/domain";
import { KnowledgeNotebookPanel } from "./KnowledgeNotebookPanel";
import { tutorApi } from "@/lib/tutor-api";

const now = Date.parse("2026-10-04T09:00:00Z");
const conceptId = createObjectiveId("go-slices");
const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: createAreaId("study-go"),
  title: "Go programming",
  description: "Study course notes and investigate unfamiliar code.",
  language: "en",
  objectives: [
    { id: conceptId, title: "Slices and backing arrays", description: null, prerequisiteIds: [] },
  ],
  ai: {
    tutorInstructions: "Use short Go examples.",
    quizInstructions: null,
    cardGenerationInstructions: null,
  },
  cards: [],
  tags: ["go"],
  licence: null,
};
const seed = Effect.runSync(
  seedKnowledgeNotebook(area, "Understand Go slice aliasing and apply it to real code."),
);
const ready: KnowledgeNotebook = {
  ...seed,
  session: { ...seed.session, phase: "active", startedAt: now, maxRequests: 50 },
};
const material: StudyMaterial = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "Go workshop — slices.pdf",
  format: "pdf",
  importedAt: now,
  warnings: ["Check extracted code indentation and page breaks before generating cards."],
  sections: [
    {
      id: "00000000-0000-4000-8000-000000000011",
      title: "Slices and shared storage",
      pageNumber: 7,
      selected: true,
      text: "A slice describes a segment of an underlying array. Copying a slice does not copy its backing array.\n\na := []int{1, 2, 3}\nb := a[:2]\nb[0] = 9\n// a now contains [9 2 3]\n\nTo obtain independent elements, allocate a destination and use copy. An append may reuse capacity or allocate a new array.",
    },
  ],
};
const preview = Effect.runSync(addNotebookMaterial(ready, material));
const proposals = Effect.runSync(
  addMaterialCardProposals(preview, {
    materialId: material.id,
    sectionId: material.sections[0]?.id,
    proposals: [
      {
        id: "00000000-0000-4000-8000-000000000012",
        conceptId,
        createdAt: now,
        providerSessionId: "00000000-0000-4000-8000-000000000013",
        providerResolutionRequired: false,
        proposal: {
          front: "Does copying a Go slice copy its elements?",
          back: "No. The new slice descriptor may refer to the same backing array; allocate a destination and use copy for independent elements.",
          rationale: "Distinguish a copied descriptor from independently stored elements.",
          objectiveId: conceptId,
        },
        sourceReferences: [
          {
            materialId: material.id,
            sectionId: material.sections[0]?.id,
            quote: "Copying a slice does not copy its backing array.",
            pageNumber: 7,
          },
        ],
      },
    ],
  }),
);
const api: typeof tutorApi = {
  readSession: () => Effect.succeed(null),
  resolveProposal: () => Effect.void,
  request: () => Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" }),
};
const meta = {
  title: "Screens/Study Materials",
  component: KnowledgeNotebookPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="component-catalog tutor-story">
        <div>
          <p className="eyebrow">RECALL · GO WORKSHOP · MOCK DATA</p>
          <h1>Build a deck from your course materials.</h1>
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    knowledgeArea: area,
    api,
    demo: true,
    clock: () => now,
    onApprove: async (proposal) => proposal,
    onStartReview: () => undefined,
  },
} satisfies Meta<typeof KnowledgeNotebookPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {
  name: "Materials · paste or import",
  args: { initialNotebook: ready },
};
export const Preview: Story = {
  name: "Materials · extracted PDF preview",
  args: { initialNotebook: preview },
};
export const Proposals: Story = {
  name: "Materials · source-backed proposals",
  args: { initialNotebook: proposals },
};
export const Resume: Story = {
  name: "Materials · interrupted batch retained",
  args: { initialNotebook: { ...proposals, session: { ...proposals.session, requestsUsed: 4 } } },
};
export const Budget: Story = {
  name: "Materials · budget exhausted",
  args: { initialNotebook: { ...proposals, session: { ...proposals.session, requestsUsed: 50 } } },
};
export const OcrPreview: Story = {
  name: "Materials · local OCR correction",
  args: {
    initialNotebook: Effect.runSync(
      addNotebookMaterial(ready, {
        ...material,
        name: "Photographed Go notes.png",
        format: "image",
        warnings: [
          "English OCR runs locally. Check spelling, reading order, tables, formulas and code before generating cards.",
          "OCR confidence is low; review and correct this image's extracted text.",
        ],
        sections: material.sections.map((value) => ({
          ...value,
          title: "Image text",
          pageNumber: null,
        })),
      }),
    ),
  },
};
