import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Either, Schema } from "effect";
import { WorkspaceSchema } from "@recall/domain";
import { NativeTodayScreen } from "../../../mobile/src/components/NativeTodayScreen";
import { mockWorkspace } from "../features/workspace/mock-data";

const meta = {
  title: "Screens/Mobile Client",
  component: NativeTodayScreen,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The native React Native screen rendered through React Native Web with deterministic mock workspace data.",
      },
    },
  },
} satisfies Meta<typeof NativeTodayScreen>;

export default meta;
type Story = StoryObj<typeof meta>;
const sampleMediaId = "a".repeat(64);
const decodedMediaWorkspace = Schema.decodeUnknownEither(WorkspaceSchema)({
  ...mockWorkspace,
  areas: mockWorkspace.areas.map((area) => ({
    ...area,
    cards: area.cards.map((card, index) =>
      area.id === "area-biology" && index === 0
        ? {
            ...card,
            media: [{ id: sampleMediaId, mimeType: "image/png", byteLength: 1 }],
          }
        : card,
    ),
  })),
});
const workspaceWithMedia = Either.isRight(decodedMediaWorkspace)
  ? decodedMediaWorkspace.right
  : mockWorkspace;

export const OfflineStudy: Story = {
  name: "Today · offline study (native)",
  args: {
    ready: true,
    workspace: mockWorkspace,
    activeAreaId: "area-biology",
    now: Date.parse("2026-10-03T09:00:00.000Z"),
    dateLabel: "Sat, Oct 3",
    message: null,
    showAnswer: false,
    canReset: true,
    onSelectArea: () => undefined,
    onHideAnswer: () => undefined,
    onShowAnswer: () => undefined,
    onReview: () => undefined,
    onReset: () => undefined,
  },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
};

export const AnswerRevealed: Story = {
  ...OfflineStudy,
  name: "Study · answer revealed (native)",
  args: { ...OfflineStudy.args, showAnswer: true },
};

export const StudyCardWithMedia: Story = {
  ...OfflineStudy,
  name: "Study · card with media (native)",
  args: {
    ...OfflineStudy.args,
    workspace: workspaceWithMedia,
    mediaUris: {
      [sampleMediaId]:
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 300'%3E%3Crect width='640' height='300' rx='24' fill='%23faf9f6'/%3E%3Ccircle cx='320' cy='150' r='92' fill='%23c4ed68'/%3E%3Ccircle cx='320' cy='150' r='54' fill='white'/%3E%3C/svg%3E",
    },
  },
};

export const CaughtUp: Story = {
  ...OfflineStudy,
  name: "Study · caught up (native)",
  args: {
    ...OfflineStudy.args,
    workspace: {
      ...mockWorkspace,
      areas: mockWorkspace.areas.map((area) => ({ ...area, cards: [] })),
    },
  },
};
