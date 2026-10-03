import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NativeWorkspaceAuthoringPanel } from "../../../mobile/src/components/NativeWorkspaceAuthoringPanel";
import { mockWorkspace } from "../features/workspace/mock-data";
import type { Workspace } from "@recall/domain";
const storyWorkspace: Workspace = mockWorkspace;
const importedTagsWorkspace: Workspace = {
  ...storyWorkspace,
  areas: storyWorkspace.areas.map((area, index) =>
    index !== 0
      ? area
      : {
          ...area,
          tags: [
            "cells, tissues",
            'say "ATP"',
            "  source label  ",
            "source\ncategory",
            "imported:" + "x".repeat(90),
          ],
          cards: area.cards.map((card, cardIndex) =>
            cardIndex !== 0
              ? card
              : {
                  ...card,
                  tags: [
                    "cells, tissues",
                    'say "ATP"',
                    "  source label  ",
                    "source\ncategory",
                    "imported:" + "x".repeat(90),
                  ],
                },
          ),
        },
  ),
};
const clozeWorkspace: Workspace = {
  ...storyWorkspace,
  areas: storyWorkspace.areas.map((area, index) =>
    index !== 0
      ? area
      : {
          ...area,
          cards: area.cards.map((card, cardIndex) =>
            cardIndex !== 0
              ? card
              : {
                  ...card,
                  cloze: {
                    text: "Mitochondria produce {{c1::ATP::energy molecule}}.",
                    deletionIndex: 1,
                  },
                  tags: ["cell-biology", "energy"],
                },
          ),
        },
  ),
};
const meta = {
  title: "Screens/Native Workspace Authoring",
  component: NativeWorkspaceAuthoringPanel,
  parameters: { layout: "fullscreen" },
  args: {
    workspace: storyWorkspace,
    activeAreaId: storyWorkspace.areas[0]?.id ?? null,
    createId: () => "00000000-0000-4000-8000-000000000901",
    onCommand: async (): Promise<{ ok: boolean; message: string }> => ({
      ok: true,
      message: "Saved on this device (mock).",
    }),
  },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  decorators: [
    (Story) => (
      <main style={{ minHeight: 844, padding: 16, background: "#faf9f6" }}>
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof NativeWorkspaceAuthoringPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CardLibrary: Story = {};
export const EmptyLibrary: Story = {
  args: {
    workspace: { ...storyWorkspace, areas: [] },
    activeAreaId: null,
    initialEditor: "create-area",
  },
};
export const BasicCardEditor: Story = { args: { initialEditor: "edit-card" } };
export const ImportedCardTags: Story = {
  args: { workspace: importedTagsWorkspace, initialEditor: "edit-card" },
};
export const ImportedAreaTags: Story = {
  args: { workspace: importedTagsWorkspace, initialEditor: "settings" },
};
export const ClozeCardEditor: Story = {
  args: { workspace: clozeWorkspace, initialEditor: "edit-card" },
};
export const AreaMetadataAndObjectives: Story = { args: { initialEditor: "settings" } };
export const RenameArea: Story = { args: { initialEditor: "edit-area" } };
export const ConfirmAreaDeletion: Story = { args: { initialEditor: "delete-area" } };
export const ConfirmCardDeletion: Story = { args: { initialEditor: "delete-card" } };
export const PersistenceFailure: Story = {
  args: {
    initialEditor: "edit-card",
    initialMessage: "This change could not be saved. Your draft remains here; try again.",
    onCommand: async () => ({
      ok: false,
      message: "Storage is unavailable. Your draft remains here.",
    }),
  },
};
export const SavingDisabled: Story = {
  args: {
    initialEditor: "edit-card",
    disabled: true,
    disabledReason: "A workspace change is saving. Wait before editing another item.",
  },
};

export const ReviewRetentionDefault: Story = {
  args: {
    initialEditor: "scheduler",
    workspace: { ...storyWorkspace, schedulerSettings: { requestRetention: 0.9 } },
  },
};
export const ReviewRetentionHigh: Story = {
  args: {
    initialEditor: "scheduler",
    workspace: { ...storyWorkspace, schedulerSettings: { requestRetention: 0.97 } },
  },
};
export const ReviewRetentionSaveFailure: Story = {
  args: {
    initialEditor: "scheduler",
    workspace: { ...storyWorkspace, schedulerSettings: { requestRetention: 0.97 } },
    initialMessage:
      "Review settings could not be saved. Your target remains in this draft; try again.",
    onCommand: async () => ({
      ok: false,
      message: "Storage is unavailable. Your retention draft remains here.",
    }),
  },
};
export const ObjectiveFilteredLibrary: Story = {
  args: { initialObjectiveFilter: `title:${storyWorkspace.areas[0]?.cards[0]?.objective ?? ""}` },
};
export const CombinedSearchAndObjectiveFilter: Story = {
  args: {
    initialObjectiveFilter: `title:${storyWorkspace.areas[0]?.cards[0]?.objective ?? ""}`,
    initialSearch: "ATP",
  },
};
