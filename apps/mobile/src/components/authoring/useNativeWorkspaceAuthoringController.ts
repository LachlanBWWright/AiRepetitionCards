import { emptyLibraryNotes, parseTagInput } from "@recall/application";
import { useState } from "react";

import type { CardRefinementResult } from "@recall/ai-core";

import {
  type Editor,
  type NativeWorkspaceAuthoringPanelProps,
} from "./NativeWorkspaceAuthoringPanel.types";
import { applyCardRefinement } from "./editor/ApplyRefinement";
import { createAttachmentPicker } from "./editor/AttachmentPicker";
import { createBulkWorkflow } from "./workflows/BulkWorkflow";
import { createCardSaveWorkflow } from "./workflows/CardSaveWorkflow";
import { deriveCardViews } from "./library/DerivedCardViews";
import { useDraftLifecycle } from "./drafts/DraftLifecycle";
import { createEditorBuilders } from "./workflows/EditorBuilders";
import { createEditorTransitions } from "./workflows/EditorTransitions";
import { useNativeWorkspaceAuthoringPanelState } from "./PanelState";
import { createSubmitWorkflow } from "./workflows/SubmitWorkflow";

export function useNativeWorkspaceAuthoringController({
  workspace,
  notes = emptyLibraryNotes,
  flaggedOnly: requestedFlaggedOnly,
  onFlaggedFilterChange,
  notesLoaded = true,
  onRetainDraft,
  onFlushDraft,
  onDiscardDraft,
  onFlag,
  onSelectDeck,
  now: currentTime,
  onGenerateCards,
  onStudy,
  onImportCards,
  activeAreaId,
  tutorApi = null,
  disabled = false,
  disabledReason,
  createId,
  onCommand,
  onPickAttachment,
  initialEditor,
  initialMessage,
  initialObjectiveFilter,
  initialSearch,
  searchTarget,
  initialShowDuplicates = false,
  initialHistory = false,
}: NativeWorkspaceAuthoringPanelProps) {
  const [initialTime] = useState(() => Date.now());
  const now = currentTime ?? initialTime;
  const [creationChoices, setCreationChoices] = useState(false);
  const area = workspace?.areas.find((item) => item.id === activeAreaId) ?? workspace?.areas[0];
  const {
    areaEditor,
    cardEditor,
    deleteEditor,
    schedulerEditor,
    bound,
    initialEditor: buildInitialEditor,
  } = createEditorBuilders({ workspace, area, createId });
  const [editor, setEditorState] = useState<Editor | null>(() => buildInitialEditor(initialEditor));
  const panelState = useNativeWorkspaceAuthoringPanelState({
    setEditorState,
    area,
    workspace,
    initialHistory,
    initialShowDuplicates,
    initialObjectiveFilter,
    initialSearch,
    initialMessage,
    requestedFlaggedOnly,
    onFlaggedFilterChange,
  });
  const {
    refinementDuplicate,
    setRefinementDuplicate,
    history,
    setHistory,
    showDuplicates,
    setShowDuplicates,
    keptDuplicateDraft,
    setKeptDuplicateDraft,
    setEditor,
    areaMenu,
    setAreaMenu,
    cardMenuId,
    setCardMenuId,
    showFilters,
    setShowFilters,
    showCardDetails,
    setShowCardDetails,
    query,
    setQuery,
    setObjectiveSelection,
    objectiveFilter,
    objectives,
    legacyObjectives,
    confirmation,
    setConfirmation,
    message,
    setMessage,
    pending,
    setPending,
    picking,
    setPicking,
    mounted,
    refAccesses,
    editorGeneration,
    saveActive,
    submitGuard,
    pendingOpen,
    setPendingOpen,
    setSelectedCards,
    selectionAreaId,
    setSelectionAreaId,
    flaggedOnly,
    setFlaggedOnly,
    bulkAction,
    setBulkAction,
    bulkTags,
    setBulkTags,
    bulkDestination,
    setBulkDestination,
    bulkRequest,
    setBulkRequest,
    bulkSnapshot,
    selectedIds,
  } = panelState;
  const locked = disabled || pending || picking;
  function editorTransitions() {
    return createEditorTransitions({
      locked,
      disabled,
      bulkAction,
      saveActive: refAccesses.saveActive,
      pickerToken: refAccesses.pickerToken,
      editorGeneration: refAccesses.editorGeneration,
      workspace,
      bound,
      snapshotDraft,
      retainCurrentDraft,
      setPendingOpen,
      setEditor,
      setPicking,
      setConfirmation,
      setMessage,
      setAreaMenu,
      setCardMenuId,
      setShowCardDetails,
      setRefinementDuplicate,
    });
  }
  function open(next: Editor | null) {
    editorTransitions().open(next);
  }
  function openDirectly(next: Editor | null) {
    editorTransitions().openDirectly(next);
  }
  function openExistingCard(areaId: string, cardId: string, includeSource: boolean) {
    editorTransitions().openExistingCard(areaId, cardId, includeSource);
  }
  const { snapshotDraft, retainCurrentDraft, keepDraftAndClose, resumeDraft } = useDraftLifecycle({
    editor,
    workspace,
    notesLoaded,
    onRetainDraft,
    onFlushDraft,
    onDiscardDraft,
    onSelectDeck,
    pendingOpen,
    setPendingOpen,
    setMessage,
    open,
    openDirectly,
  });

  function submit(command: unknown, expectedBaseline?: string, continueAdding = false) {
    createSubmitWorkflow({
      disabled,
      pickerToken: refAccesses.pickerToken,
      submitGuard,
      saveActive: refAccesses.saveActive,
      editorGeneration: refAccesses.editorGeneration,
      editor,
      onCommand,
      mounted: refAccesses.mounted,
      setPending,
      setMessage,
      setPendingOpen,
      snapshotDraft,
      onDiscardDraft,
      bulkAction,
      setBulkAction,
      setSelectedCards,
      setBulkRequest,
      setCreationChoices,
      setKeptDuplicateDraft,
      setShowCardDetails,
      setRefinementDuplicate,
      setEditor,
      createId,
      setConfirmation,
    })(command, expectedBaseline, continueAdding);
  }
  function bulkWorkflow() {
    return createBulkWorkflow({
      editor,
      area,
      workspace,
      locked,
      action: bulkAction,
      tags: bulkTags,
      destination: bulkDestination,
      selectedIds,
      selectionAreaId,
      request: bulkRequest,
      snapshot: {
        get: () => bulkSnapshot.current,
        set: (value) => {
          bulkSnapshot.current = value;
        },
      },
      createId,
      setAction: setBulkAction,
      setRequest: setBulkRequest,
      setMessage,
      bound,
      submit,
    });
  }
  function beginBulk(action: "tags" | "move" | "delete") {
    bulkWorkflow().begin(action);
  }
  function submitBulk() {
    bulkWorkflow().submitBulk();
  }
  async function pickAttachment(): Promise<void> {
    await createAttachmentPicker({
      editor,
      disabled,
      saveActive: refAccesses.saveActive,
      pickerToken: refAccesses.pickerToken,
      editorGeneration: refAccesses.editorGeneration,
      mounted: refAccesses.mounted,
      onPickAttachment,
      setPicking,
      setMessage,
      setEditor,
    })();
  }
  async function applyRefinement(
    result: CardRefinementResult,
    acceptedKey?: string,
  ): Promise<boolean> {
    return applyCardRefinement(
      {
        editor,
        locked,
        workspace,
        createId,
        onCommand,
        parseTags: parseTagInput,
        submitGuard,
        editorGeneration,
        mounted,
        saveActive,
        setEditor,
        setMessage,
        setRefinementDuplicate,
        setPending,
        setConfirmation,
      },
      result,
      acceptedKey,
    );
  }
  const viewData = deriveCardViews({
    editor,
    area,
    workspace,
    showDuplicates,
    keptDuplicateDraft,
    query,
    objectiveFilter,
    objectives,
    flaggedOnly,
    notes,
  });
  function saveCard(continueAdding: boolean) {
    createCardSaveWorkflow({
      editor,
      duplicateCount: viewData.draftDuplicates.length,
      duplicatesAccepted: viewData.duplicatesAccepted,
      setMessage,
      submit,
    })(continueAdding);
  }
  return {
    workspace,
    notes,
    area,
    now,
    locked,
    disabled,
    disabledReason,
    message,
    pending,
    picking,
    notesLoaded,
    onRetainDraft,
    onSelectDeck,
    onStudy,
    onImportCards,
    onGenerateCards,
    onFlag,
    searchTarget,
    editor,
    history,
    showDuplicates,
    duplicatePairs: viewData.duplicatePairs,
    pendingOpen,
    creationChoices,
    setCreationChoices,
    setPendingOpen,
    keepDraftAndClose,
    onDiscardCurrentDraft: () => {
      const draft = snapshotDraft();
      if (draft) onDiscardDraft?.(draft.key);
      const next = pendingOpen?.next ?? null;
      setPendingOpen(null);
      openDirectly(next);
    },
    resumeDraft,
    retainCurrentDraft,
    areaEditor,
    cardEditor,
    open,
    openExistingCard,
    setHistory,
    setShowDuplicates,
    setObjectiveSelection,
    setShowFilters,
    areaMenu,
    setAreaMenu,
    schedulerEditor,
    deleteEditor,
    setEditor,
    setMessage,
    submit,
    createId,
    tutorApi,
    viewData,
    refinementDuplicate,
    applyRefinement,
    showCardDetails,
    setShowCardDetails,
    onPickAttachment,
    pickAttachment,
    setRefinementDuplicate,
    setKeptDuplicateDraft,
    saveCard,
    confirmation,
    setConfirmation,
    flaggedOnly,
    setFlaggedOnly,
    query,
    setQuery,
    objectives,
    legacyObjectives,
    showFilters,
    objectiveFilter,
    selectedIds,
    bulkAction,
    bulkTags,
    bulkDestination,
    bulkRequest,
    beginBulk,
    submitBulk,
    setBulkTags,
    setBulkDestination,
    setBulkAction,
    setBulkRequest,
    setSelectedCards,
    setSelectionAreaId,
    cardMenuId,
    setCardMenuId,
    bound,
  };
}
export type NativeWorkspaceAuthoringController = ReturnType<
  typeof useNativeWorkspaceAuthoringController
>;
