import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  createAreaId,
  createAssessmentId,
  type CardVersion,
  type Assessment,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { CardVersionHistory } from "./CardVersionHistory";

const card: Assessment = {
  id: createAssessmentId("history-channel"),
  front: "What does a Go channel do?",
  back: "It communicates values between goroutines.",
  objective: "Concurrency",
  tags: ["Go"],
  origin: "authored",
  schedule: newSchedule(new Date("2026-10-05T09:00:00.000Z")),
};
const version: CardVersion = {
  id: "channel-before-edit",
  cardId: card.id,
  areaId: createAreaId("history-go"),
  recordedAt: "2026-10-04T09:00:00.000Z",
  reason: "edit",
  card: { ...card, back: "It passes messages." },
  area: { id: createAreaId("history-go"), title: "Go", color: "#c4ed68", cards: [] },
};
const meta = {
  title: "Cards/Version history",
  component: CardVersionHistory,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main
        className="mx-auto max-w-5xl space-y-6 p-8"
        style={{ padding: 32, maxWidth: 960, marginInline: "auto" }}
      >
        <Story />
      </main>
    ),
  ],
  args: {
    versions: [version],
    currentCard: card,
    initialSelectedVersionId: version.id,
    onRestore: async (): Promise<boolean> => true,
  },
} satisfies Meta<typeof CardVersionHistory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CompareAndRestore: Story = {};
export const DeletedCard: Story = {
  args: { currentCard: undefined, versions: [{ ...version, reason: "delete" }] },
};
export const SaveFailure: Story = { args: { onRestore: async () => false } };
export const Mobile: Story = { globals: { viewport: { value: "recallMobile", isRotated: false } } };

export const RestoreCopy: Story = {
  args: {
    currentCard: undefined,
    restoresAsCopy: true,
    versions: [{ ...version, reason: "delete" }],
  },
};
