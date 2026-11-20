import { WorkspaceBackupActions } from "./WorkspaceBackupActions";
import { useRef, type ChangeEvent } from "react";
import { ToggleGroup, ToggleGroupItem } from "@recall/ui-web/components/toggle-group";
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
  readonly onImportDelimited: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onExportDelimited: (delimiter: "," | "\t") => void;
  readonly onExportWorkspaceBackup: () => void;
  readonly onRestoreDesktopBackup: () => void;
  readonly onRestoreWorkspaceBackup: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly color: string;
};

function taskLabel(task: LibraryTool): string {
  if (task === "import") return "Import cards";
  if (task === "export") return "Export deck";
  return "Workspace backup";
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
  const delimitedPicker = useRef<HTMLInputElement>(null);
  const backupPicker = useRef<HTMLInputElement>(null);
  const restoreBackup = () => {
    if (isDesktopRuntime()) onRestoreDesktopBackup();
    else backupPicker.current?.click();
  };
  const chooseTask = (value: string) => {
    if (value === "import" || value === "export") setLibraryTools(value);
  };
  const taskChoices = (["import", "export"] as const).map((task) => (
    <ToggleGroupItem key={task} value={task}>
      {taskLabel(task)}
    </ToggleGroupItem>
  ));
  return (
    <Dialog open={open && workspaceUnlocked} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto sm:max-w-xl"
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
                : "Save a copy of your workspace or restore an existing backup."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4" aria-label="Deck transfer tools">
          {libraryTools !== "backup" && (
            <ToggleGroup
              type="single"
              value={libraryTools}
              onValueChange={chooseTask}
              className="flex flex-wrap gap-2"
              aria-label="Choose transfer task"
            >
              {taskChoices}
            </ToggleGroup>
          )}
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
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              <AnkiImportAction color={color} onAccept={onAcceptAnkiImport} />
              <Button variant="secondary" onClick={() => delimitedPicker.current?.click()}>
                Import CSV/TSV
              </Button>
              <input
                ref={delimitedPicker}
                className="sr-only"
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                onChange={onImportDelimited}
              />
            </div>
          )}
          {libraryTools === "export" && (
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              <Button
                variant="secondary"
                onClick={createDelimitedExportHandler(onExportDelimited, ",")}
                disabled={!area}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                onClick={createDelimitedExportHandler(onExportDelimited, "\t")}
                disabled={!area}
              >
                Export TSV
              </Button>
            </div>
          )}
          {libraryTools === "backup" && (
            <>
              <WorkspaceBackupActions onSave={onExportWorkspaceBackup} onRestore={restoreBackup} />
              <input
                ref={backupPicker}
                className="sr-only"
                type="file"
                accept="application/zip,.zip,application/json,.json"
                onChange={onRestoreWorkspaceBackup}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
