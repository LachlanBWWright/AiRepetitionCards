import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NativeCardHistoryPanel } from "../../../mobile/src/components/NativeCardHistoryPanel";
import { mockWorkspace } from "../features/workspace/mock-data";
import type { Workspace } from "@recall/domain";
const area = mockWorkspace.areas[0];
const card = area?.cards[0];
const workspace: Workspace =
  area && card
    ? {
        ...mockWorkspace,
        cardVersions: [
          {
            id: "mock-version-1",
            areaId: area.id,
            cardId: card.id,
            recordedAt: "2026-10-04T08:00:00.000Z",
            reason: "edit",
            card: { ...card, back: "An earlier answer saved before refinement." },
            area: { ...area, cards: [] },
          },
        ],
      }
    : mockWorkspace;
const meta = {
  title: "Screens/Native Card History",
  component: NativeCardHistoryPanel,
  parameters: { layout: "fullscreen" },
  args: { workspace, onRestore: () => undefined },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  decorators: [
    (Story) => (
      <main style={{ minHeight: 844, padding: 16, background: "#faf9f6" }}>
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof NativeCardHistoryPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Versions: Story = {};
export const VersionPreview: Story = { args: { initialVersionId: "mock-version-1" } };
export const DeletedCard: Story = {
  args: {
    workspace: {
      ...workspace,
      areas: workspace.areas.map((item) => ({
        ...item,
        cards: item.cards.filter((itemCard) => itemCard.id !== card?.id),
      })),
    },
  },
};
export const EmptyHistory: Story = { args: { workspace: mockWorkspace } };

function ObservedRestore(args: ComponentProps<typeof NativeCardHistoryPanel>) {
  const [restored, setRestored] = useState<string | null>(null);
  return (
    <>
      <NativeCardHistoryPanel
        {...args}
        onRestore={(command, baseline) =>
          setRestored(JSON.stringify({ command, baselineCaptured: baseline !== undefined }))
        }
      />
      {restored && (
        <output role="status" aria-label="Restore result">
          {restored}
        </output>
      )}
    </>
  );
}
export const ActiveRestoreInteraction: Story = {
  args: { initialVersionId: "mock-version-1" },
  render: ObservedRestore,
};
export const DeletedRestoreInteraction: Story = {
  ...DeletedCard,
  args: { ...DeletedCard.args, initialVersionId: "mock-version-1" },
  render: ObservedRestore,
};
export const SavingDisabled: Story = {
  args: { initialVersionId: "mock-version-1", disabled: true },
};

export const SyncedDeletedRestoreInteraction: Story = {
  ...DeletedRestoreInteraction,
  args: {
    ...DeletedRestoreInteraction.args,
    workspace: {
      ...(DeletedCard.args?.workspace ?? workspace),
      syncOwnerId: "00000000-0000-4000-8000-000000000901",
    },
  },
};
