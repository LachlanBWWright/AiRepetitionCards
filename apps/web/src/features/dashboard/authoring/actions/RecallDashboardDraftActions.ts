import { createAreaId } from "@recall/domain";
import { type LibraryDraft } from "@recall/application";
import { readDraftFile } from "@/lib/library-notes-store";
import type { RecallDashboardCore } from "../../state/useRecallDashboardController";
import type { createRecallDashboardEditorCloseActions } from "./RecallDashboardEditorCloseActions";
export function createRecallDashboardDraftActions(
  model: Pick<
    RecallDashboardCore & ReturnType<typeof createRecallDashboardEditorCloseActions>,
    | "reviewSaving"
    | "libraryMutation"
    | "cardSaving"
    | "addingCard"
    | "addingArea"
    | "retainOpenDraft"
    | "closeCardEditor"
    | "closeAreaEditor"
    | "areaEditor"
    | "setEditingAreaId"
    | "setAreaTitle"
    | "setAreaColor"
    | "setAddingArea"
    | "workspaceRef"
    | "setImportNotice"
    | "cardEditor"
    | "setSelectedId"
    | "setEditingCardId"
    | "setFront"
    | "setBack"
    | "setCardKind"
    | "setClozeText"
    | "setClozeIndex"
    | "setCardTags"
    | "setCardObjectiveIds"
    | "setRemovedMediaIds"
    | "setMediaFile"
    | "notesScope"
    | "setCardEditorError"
    | "setCardDraftStale"
    | "setAddingCard"
    | "libraryNotes"
    | "draftClose"
    | "setDraftClose"
    | "snapshotOpenLibraryDraft"
  >,
) {
  const {
    reviewSaving,
    libraryMutation,
    cardSaving,
    addingCard,
    addingArea,
    retainOpenDraft,
    closeCardEditor,
    closeAreaEditor,
    areaEditor,
    setEditingAreaId,
    setAreaTitle,
    setAreaColor,
    setAddingArea,
    workspaceRef,
    setImportNotice,
    cardEditor,
    setSelectedId,
    setEditingCardId,
    setFront,
    setBack,
    setCardKind,
    setClozeText,
    setClozeIndex,
    setCardTags,
    setCardObjectiveIds,
    setRemovedMediaIds,
    setMediaFile,
    notesScope,
    setCardEditorError,
    setCardDraftStale,
    setAddingCard,
    libraryNotes,
    draftClose,
    setDraftClose,
    snapshotOpenLibraryDraft,
  } = model;
  function resumeLibraryDraft(draft: LibraryDraft) {
    if (reviewSaving || libraryMutation !== null || cardSaving) return;
    if (addingCard || addingArea) {
      retainOpenDraft();
      closeCardEditor();
      closeAreaEditor();
    }
    if (draft.kind === "area") {
      areaEditor.current = {
        generation: areaEditor.current.generation + 1,
        id: draft.mode === "edit" || draft.id !== "new" ? createAreaId(draft.id) : null,
        baseline: draft.baseline,
      };
      setEditingAreaId(draft.mode === "edit" ? draft.id : null);
      setAreaTitle(draft.title);
      setAreaColor(draft.color);
      setAddingArea(true);
      return;
    }
    if (!workspaceRef.current.areas.some((item) => item.id === draft.areaId)) {
      setImportNotice("This draft’s deck no longer exists. Copy its text before discarding it.");
      return;
    }
    cardEditor.current = {
      generation: cardEditor.current.generation + 1,
      baseline: draft.baseline,
      sourceCard: draft.sourceCard ?? null,
    };
    setSelectedId(draft.areaId);
    setEditingCardId(draft.mode === "edit" ? draft.id : null);
    setFront(draft.front);
    setBack(draft.back);
    setCardKind(draft.cardKind);
    setClozeText(draft.clozeText);
    setClozeIndex(draft.clozeIndex);
    setCardTags(draft.tagsText);
    setCardObjectiveIds(draft.objectiveIds);
    setRemovedMediaIds(draft.removedMediaIds);
    setMediaFile(readDraftFile(notesScope, draft.key));
    setCardEditorError(null);
    setCardDraftStale(false);
    setAddingCard(true);
  }
  async function keepDraftAndClose() {
    retainOpenDraft();
    if (!(await libraryNotes.flush())) {
      setImportNotice(
        "The draft couldn’t be retained. Keep editing here or retry saving drafts before closing.",
      );
      return;
    }
    if (draftClose === "card") closeCardEditor();
    else closeAreaEditor();
    setDraftClose(null);
  }
  function requestDraftClose(kind: "card" | "area") {
    if (cardSaving || libraryMutation !== null) return;
    const draft = snapshotOpenLibraryDraft();
    if (draft) {
      retainOpenDraft();
      setDraftClose(kind);
    } else if (kind === "card") closeCardEditor();
    else closeAreaEditor();
  }
  return { resumeLibraryDraft, keepDraftAndClose, requestDraftClose } as const;
}
