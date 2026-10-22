import { applyAnkiImport } from "@recall/application";
import { Effect } from "effect";
import { RecallDashboardImportExportDialog } from "@/features/dashboard/transfers/RecallDashboardImportExportDialog";
import { dashboardColors as colors } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardReviewRecovery({ model }: { readonly model: RecallDashboardModel }) {
  const {
    importExportOpen,
    setImportExportOpen,
    libraryTools,
    accountMenuTrigger,
    workspaceUnlocked,
    setLibraryTools,
    area,
    deckTransferWorkspace,
    libraryNotes,
    notesScope,
    reviewSaving,
    reviewSaveFailed,
    cardSaving,
    libraryMutation,
    demo,
    cacheWritable,
    importPortableDeck,
    contentImportPending,
    pendingContentImport,
    commitContentImport,
    importDelimited,
    exportDelimited,
    exportWorkspaceBackup,
    restoreDesktopWorkspaceBackup,
    restoreWorkspaceBackup,
    workspace,
  } = model;
  return (
    <RecallDashboardImportExportDialog
      open={importExportOpen}
      onOpenChange={setImportExportOpen}
      onCloseAutoFocus={(event) => {
        if (libraryTools === "backup") {
          event.preventDefault();
          accountMenuTrigger.current?.focus();
        }
      }}
      workspaceUnlocked={workspaceUnlocked}
      libraryTools={libraryTools}
      setLibraryTools={setLibraryTools}
      area={area}
      deckTransferWorkspace={deckTransferWorkspace}
      notesLoaded={libraryNotes.loaded}
      notesScope={notesScope}
      reviewSaving={reviewSaving}
      reviewSaveFailed={reviewSaveFailed}
      cardSaving={cardSaving}
      libraryMutation={libraryMutation}
      demo={Boolean(demo)}
      cacheWritable={cacheWritable}
      onImportPortableDeck={importPortableDeck}
      onAcceptAnkiImport={(proposal) =>
        Effect.gen(function* () {
          if (
            contentImportPending.current ||
            (pendingContentImport && pendingContentImport.area?.id !== proposal.area.id)
          )
            return yield* Effect.fail({ _tag: "AnkiImportNotSaved" } as const);
          const replacement = yield* applyAnkiImport(workspace, proposal);
          const saved = yield* Effect.tryPromise({
            try: () =>
              commitContentImport({
                replacement,
                expectedWorkspace: workspace,
                media: proposal.media,
                message: `${String(proposal.area.cards.length)} cards imported from Anki. Existing cards retain local scheduling and history.`,
              }),
            catch: () => ({ _tag: "AnkiImportAcceptanceUnavailable" }) as const,
          });
          if (!saved) return yield* Effect.fail({ _tag: "AnkiImportNotSaved" } as const);
        })
      }
      onImportDelimited={importDelimited}
      onExportDelimited={exportDelimited}
      onExportWorkspaceBackup={() => {
        void exportWorkspaceBackup();
      }}
      onRestoreDesktopBackup={() => {
        void restoreDesktopWorkspaceBackup();
      }}
      onRestoreWorkspaceBackup={(event) => {
        void restoreWorkspaceBackup(event);
      }}
      color={colors[workspace.areas.length % colors.length] ?? "#c4ed68"}
    />
  );
}
