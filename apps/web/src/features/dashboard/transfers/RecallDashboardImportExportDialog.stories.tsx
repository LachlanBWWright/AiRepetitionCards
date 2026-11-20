import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import { RecallDashboardImportExportDialog } from "./RecallDashboardImportExportDialog";

function BackupDialogStory(props: ComponentProps<typeof RecallDashboardImportExportDialog>) {
  const [open, setOpen] = useState(props.open);
  return <RecallDashboardImportExportDialog {...props} open={open} onOpenChange={setOpen} />;
}

const noop = () => undefined;
const meta = {
  title: "Screens/Workspace backup dialog",
  component: RecallDashboardImportExportDialog,
  parameters: { layout: "fullscreen" },
  render: (args) => <BackupDialogStory {...args} />,
  args: {
    open: true,
    onOpenChange: noop,
    onCloseAutoFocus: noop,
    workspaceUnlocked: true,
    libraryTools: "backup",
    setLibraryTools: noop,
    area: undefined,
    deckTransferWorkspace: null,
    notesLoaded: true,
    notesScope: "demo",
    reviewSaving: false,
    reviewSaveFailed: false,
    cardSaving: false,
    libraryMutation: null,
    demo: true,
    cacheWritable: true,
    onImportPortableDeck: () => Promise.resolve(true),
    onAcceptAnkiImport: () => Effect.void,
    onImportDelimited: noop,
    onExportDelimited: noop,
    onExportWorkspaceBackup: noop,
    onRestoreDesktopBackup: noop,
    onRestoreWorkspaceBackup: noop,
    color: "#60a5fa",
  },
} satisfies Meta<typeof RecallDashboardImportExportDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Backup: Story = {};
export const ImportCards: Story = { args: { libraryTools: "import" } };
export const ExportDeck: Story = { args: { libraryTools: "export" } };
