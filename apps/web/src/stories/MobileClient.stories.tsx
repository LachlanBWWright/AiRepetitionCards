import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Either, Schema } from "effect";
import { WorkspaceSchema } from "@recall/domain";
import { NativeTodayScreen } from "../../../mobile/src/components/NativeTodayScreen";
import { mockWorkspace } from "../features/workspace/mock-data";
import {
  deletedCardPendingWorkspace,
  deletedAreaPendingWorkspace,
  legacyMissingReviewContentWorkspace,
} from "../features/workspace/deleted-review-mock-data";

const meta = {
  title: "Screens/Mobile Client",
  component: NativeTodayScreen,
  args: { onOpenLibrary: () => undefined },
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
    onImportAnki: () => undefined,
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

export const ReviewSaving: Story = {
  ...AnswerRevealed,
  name: "Study · saving review (native)",
  args: { ...AnswerRevealed.args, reviewPending: true },
};

export const DeletedCardWaitingForSync: Story = {
  ...OfflineStudy,
  name: "Today · deleted card review waiting for sync (native)",
  args: { ...OfflineStudy.args, workspace: deletedCardPendingWorkspace },
};

export const DeletedAreaWaitingForSync: Story = {
  ...OfflineStudy,
  name: "Today · deleted area review waiting for sync (native)",
  args: { ...OfflineStudy.args, workspace: deletedAreaPendingWorkspace },
};

export const OlderDeletedReviewRecovery: Story = {
  ...OfflineStudy,
  name: "Today · missing deleted review content recovery (native)",
  args: {
    ...OfflineStudy.args,
    workspace: legacyMissingReviewContentWorkspace,
    message:
      "A pending review refers to deleted content that this older workspace no longer contains. Export this device's current private backup or review snapshot before replacing it with an older backup containing that card. Your reviews remain saved; backups are not automatically merged.",
  },
};
