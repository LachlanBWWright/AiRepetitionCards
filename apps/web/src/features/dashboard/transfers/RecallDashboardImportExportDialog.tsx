import type React from "react";
import { Effect } from "effect";
import type { AnkiImportProposal, ImportedPortableDeckPackage } from "@recall/application";
import type { Workspace } from "@/features/workspace/types";
import type { LearningArea } from "@/features/workspace/types";
import { Button } from "@/components/ui/Button";
import { AnkiImportAction } from "@/features/interchange/AnkiImportAction";
import { PortableDeckTransfer } from "@/features/deck-transfer/PortableDeckTransfer";
import { isDesktopRuntime } from "@/lib/desktop-api";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";

type LibraryTool = "import" | "export" | "backup";

type Props = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCloseAutoFocus: (event: Event) => void;
  readonly workspaceUnlocked: boolean;
  readonly libraryTools: LibraryTool;
  readonly setLibraryTools: (tool: LibraryTool) => void;
  readonly area: LearningArea | undefined;
  readonly deckTransferWorkspace: Workspace | null;
  readonly notesLoaded: boolean;
  readonly notesScope: string;
  readonly reviewSaving: boolean;
  readonly reviewSaveFailed: boolean;
  readonly cardSaving: boolean;
  readonly libraryMutation: "area-save" | "area-delete" | "card-delete" | null;
  readonly demo: boolean;
  readonly cacheWritable: boolean;
  readonly onImportPortableDeck: (
    imported: ImportedPortableDeckPackage,
    restorePrivateHistory: boolean,
  ) => Promise<boolean>;
  readonly onAcceptAnkiImport: (proposal: AnkiImportProposal) => Effect.Effect<void, unknown>;
  readonly onImportDelimited: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly onExportDelimited: (delimiter: "," | "\t") => void;
  readonly onExportWorkspaceBackup: () => void;
  readonly onRestoreDesktopBackup: () => void;
  readonly onRestoreWorkspaceBackup: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly color: string;
};

function taskLabel(task: LibraryTool): string {
  if (task === "import") return "Import cards";
  if (task === "export") return "Export deck";
  return "Workspace backup";
}

function createTaskSelectionHandler(setLibraryTools: Props["setLibraryTools"], task: LibraryTool) {
  return () => {
    setLibraryTools(task);
  };
}

function createDelimitedExportHandler(
  onExportDelimited: Props["onExportDelimited"],
  delimiter: "," | "\t",
) {
  return function exportDelimited() {
    onExportDelimited(delimiter);
  };
}

export function RecallDashboardImportExportDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  workspaceUnlocked,
  libraryTools,
  setLibraryTools,
  area,
  deckTransferWorkspace,
  notesLoaded,
  notesScope,
  reviewSaving,
  reviewSaveFailed,
  cardSaving,
  libraryMutation,
  demo,
  cacheWritable,
  onImportPortableDeck,
  onAcceptAnkiImport,
  onImportDelimited,
  onExportDelimited,
  onExportWorkspaceBackup,
  onRestoreDesktopBackup,
  onRestoreWorkspaceBackup,
  color,
}: Props) {
  return (
    <Dialog open={open && workspaceUnlocked} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {libraryTools === "import"
              ? "Import cards"
              : libraryTools === "export"
                ? "Export deck"
                : "Workspace backup"}
          </DialogTitle>
          <DialogDescription>
            {libraryTools === "import"
              ? "Validate and preview cards before adding a separate deck. Existing decks stay available."
              : libraryTools === "export"
                ? `Export ${area?.title ?? "the selected deck"} as CSV or TSV. These formats include text and tags, but omit attachments and review history.`
                : "A backup includes all decks, schedules, review history and attachments. Restore replaces the workspace. Drafts and editing flags are stored separately."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" aria-label="Deck transfer tools">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Choose transfer task">
            {(["import", "export", "backup"] as const).map((task) => (
              <Button
                key={task}
                variant="secondary"
                aria-pressed={libraryTools === task}
                onClick={createTaskSelectionHandler(setLibraryTools, task)}
              >
                {taskLabel(task)}
              </Button>
            ))}
          </div>
          {libraryTools !== "backup" && deckTransferWorkspace && notesLoaded && (
            <PortableDeckTransfer
              key={`portable:${notesScope}`}
              area={area ?? null}
              workspace={deckTransferWorkspace}
              mediaStore={browserMediaStore}
              disabled={
                reviewSaving ||
                reviewSaveFailed ||
                cardSaving ||
                libraryMutation !== null ||
                (!demo && !cacheWritable)
              }
              onImport={onImportPortableDeck}
            />
          )}
          {libraryTools === "import" && (
            <div className="flex flex-wrap gap-2">
              <AnkiImportAction color={color} onAccept={onAcceptAnkiImport} />
              <label
                className="inline-flex min-h-8 cursor-pointer items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline"
                htmlFor="delimited-import"
              >
                Import CSV/TSV
              </label>
              <input
                id="delimited-import"
                className="sr-only"
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                onChange={onImportDelimited}
              />
            </div>
          )}
          {libraryTools === "export" && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                onClick={createDelimitedExportHandler(onExportDelimited, ",")}
                disabled={!area}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                onClick={createDelimitedExportHandler(onExportDelimited, "\t")}
                disabled={!area}
              >
                Export TSV
              </Button>
            </div>
          )}
          {libraryTools === "backup" && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                onClick={onExportWorkspaceBackup}
              >
                Backup workspace
              </Button>
              <label
                className="inline-flex min-h-8 cursor-pointer items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline"
                htmlFor={isDesktopRuntime() ? undefined : "workspace-backup-import"}
                onClick={isDesktopRuntime() ? onRestoreDesktopBackup : undefined}
              >
                Restore backup
              </label>
              <input
                id="workspace-backup-import"
                className="sr-only"
                type="file"
                accept="application/zip,.zip,application/json,.json"
                onChange={onRestoreWorkspaceBackup}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
