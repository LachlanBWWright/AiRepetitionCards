import { discardLibraryDraft } from "@recall/application";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { RecallDashboardEntryDialogs } from "@/features/dashboard/dialogs/RecallDashboardEntryDialogs";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardDialogs({ model }: { readonly model: RecallDashboardModel }) {
  const {
    pendingConfirmation,
    workspaceUnlocked,
    setPendingConfirmation,
    draftClose,
    setDraftClose,
    libraryNotes,
    activityRestoreError,
    snapshotOpenLibraryDraft,
    closeCardEditor,
    closeAreaEditor,
    keepDraftAndClose,
    creationChoices,
    setCreationChoices,
    area,
    addCard,
    generateCards,
    setLibraryTools,
    setImportExportOpen,
    onViewChange,
    selectedId,
    setActiveView,
  } = model;
  return (
    <RecallDashboardEntryDialogs
      confirmation={pendingConfirmation}
      workspaceUnlocked={workspaceUnlocked}
      onClearConfirmation={() => {
        setPendingConfirmation(null);
      }}
      draftClose={draftClose}
      onDraftCloseChange={setDraftClose}
      draftError={libraryNotes.error ?? activityRestoreError}
      onRetryDraftSave={libraryNotes.retry}
      onDiscardDraft={() => {
        const draft = snapshotOpenLibraryDraft();
        if (draft) libraryNotes.update((notes) => discardLibraryDraft(notes, draft.key));
        if (draftClose === "card") closeCardEditor();
        else closeAreaEditor();
        setDraftClose(null);
      }}
      draftsLoaded={libraryNotes.loaded}
      onKeepDraftClose={() => {
        void keepDraftAndClose();
      }}
      creationChoices={creationChoices}
      onCreationChoicesChange={setCreationChoices}
      areaTitle={area?.title}
      onAddCard={() => {
        setCreationChoices(false);
        addCard();
      }}
      onGenerateCards={generateCards}
      onImportCards={() => {
        setCreationChoices(false);
        setLibraryTools("import");
        setImportExportOpen(true);
        if (onViewChange) onViewChange(DashboardView.Library, selectedId, "import");
        else setActiveView(DashboardView.Library);
      }}
      onFinishLater={() => {
        setCreationChoices(false);
        setActiveView(DashboardView.Library, selectedId);
      }}
    />
  );
}
