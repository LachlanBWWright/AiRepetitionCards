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
        Effect.tryPromise({
          try: async () => {
            if (
              contentImportPending.current ||
              (pendingContentImport && pendingContentImport.area?.id !== proposal.area.id)
            )
              return false;
            return commitContentImport({
              area: proposal.area,
              media: proposal.media,
              reviewEvents: proposal.reviewEvents,
              message: `${String(proposal.area.cards.length)} cards and ${String(proposal.reviewEvents.length)} reviews imported from Anki. FSRS schedules were rebuilt from the review history.`,
            });
          },
          catch: () => ({ _tag: "AnkiImportAcceptanceUnavailable" }) as const,
        }).pipe(
          Effect.flatMap((saved) =>
            saved ? Effect.void : Effect.fail({ _tag: "AnkiImportNotSaved" } as const),
          ),
        )
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
