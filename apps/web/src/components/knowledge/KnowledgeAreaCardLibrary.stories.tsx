import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type LearningArea,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { KnowledgeAreaCardLibrary } from "./KnowledgeAreaCardLibrary";

const structuresId = createObjectiveId("storybook-cell-structures");
const expressionId = createObjectiveId("storybook-gene-expression");
const area: LearningArea = {
  id: createAreaId("storybook-library"),
  title: "Cell biology",
  color: "#c4ed68",
  objectives: [
    { id: structuresId, title: "Cell structures", description: null, prerequisiteIds: [] },
    { id: expressionId, title: "Gene expression", description: null, prerequisiteIds: [] },
  ],
  cards: [
    {
      id: createAssessmentId("storybook-mitochondria"),
      front: "What is the main role of mitochondria?",
      back: "They produce ATP through cellular respiration.",
      objective: "Cell structures",
      objectiveIds: [structuresId],
      tags: ["organelles", "energy"],
      origin: "authored",
      schedule: newSchedule(new Date("2026-10-03T09:00:00.000Z")),
    },
    {
      id: createAssessmentId("storybook-transcription"),
      front: "Where does transcription happen in a eukaryotic cell?",
      back: "In the nucleus, where DNA is used to make RNA.",
      objective: "Gene expression",
      objectiveIds: [expressionId],
      tags: ["DNA", "RNA"],
      origin: "authored",
      schedule: newSchedule(new Date("2026-10-10T09:00:00.000Z")),
    },
    {
      id: createAssessmentId("storybook-golgi"),
      front: "Which organelle modifies and packages proteins?",
      back: "The Golgi apparatus.",
      objective: "Cell structures",
      objectiveIds: [structuresId],
      tags: ["organelles", "proteins"],
      origin: "imported",
      schedule: newSchedule(new Date("2026-10-17T09:00:00.000Z")),
    },
  ],
};

const meta = {
  title: "Screens/Card Library",
  component: KnowledgeAreaCardLibrary,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-5xl space-y-6 p-8">
        <div style={{ width: "100%", maxWidth: 960, marginInline: "auto" }}>
          <Story />
        </div>
      </main>
    ),
  ],
  args: { area, onEdit: () => undefined, onDelete: () => undefined, onAdd: () => undefined },
} satisfies Meta<typeof KnowledgeAreaCardLibrary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllCards: Story = { name: "Library · due and scheduled cards" };
export const Empty: Story = { args: { area: { ...area, cards: [] } } };
export const Mobile: Story = {
  globals: { viewport: { value: "recallMobile", isRotated: false } },
};

const firstCard = area.cards[0];
export const DuplicateCards: Story = {
  args: {
    area: {
      ...area,
      cards: firstCard
        ? [
            ...area.cards,
            { ...firstCard, id: createAssessmentId("storybook-duplicate-mitochondria") },
          ]
        : area.cards,
    },
  },
};
export const WithVersionHistory: Story = {
  args: {
    workspace: {
      schemaVersion: 1,
      areas: [area],
      reviews: 0,
      cardVersions: firstCard
        ? [
            {
              id: "storybook-mitochondria-edit",
              areaId: area.id,
              cardId: firstCard.id,
              recordedAt: "2026-10-03T10:00:00.000Z",
              reason: "edit",
              card: { ...firstCard, back: "They release energy." },
              area: { ...area, cards: [] },
            },
          ]
        : [],
    },
    onRestoreVersion: async (): Promise<boolean> => true,
  },
};
