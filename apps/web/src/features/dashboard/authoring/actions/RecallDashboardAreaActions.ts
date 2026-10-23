import { Effect, Either } from "effect";
import { createAreaId } from "@recall/domain";
import { type WorkspaceAuthoringCommand, discardLibraryDraft } from "@recall/application";
import { type LearningArea } from "@/features/workspace/types";
import {
  areaEditingBaseline,
  staleAreaDraftMessage,
} from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardCore } from "../../state/useRecallDashboardController";
import type { createRecallDashboardBulkActions } from "./RecallDashboardBulkActions";
import type { createRecallDashboardEditorCloseActions } from "./RecallDashboardEditorCloseActions";
export function createRecallDashboardAreaActions(
  model: Pick<
    RecallDashboardCore &
      ReturnType<typeof createRecallDashboardBulkActions> &
      ReturnType<typeof createRecallDashboardEditorCloseActions>,
    | "libraryMutationPending"
    | "cardSavePending"
    | "areaTitle"
    | "areaEditor"
    | "editingAreaId"
    | "areaColor"
    | "setLibraryMutation"
    | "setAreaEditorError"
    | "saveAuthoringCommand"
    | "cardEditorMounted"
    | "setAreaDraftStale"
    | "setSelectedId"
    | "setImportNotice"
    | "libraryNotes"
    | "closeAreaEditor"
    | "setCreationChoices"
    | "workspaceRef"
    | "setEditingAreaId"
    | "setAreaTitle"
    | "setAreaColor"
    | "setAddingArea"
  >,
) {
  const {
    libraryMutationPending,
    cardSavePending,
    areaTitle,
    areaEditor,
    editingAreaId,
    areaColor,
    setLibraryMutation,
    setAreaEditorError,
    saveAuthoringCommand,
    cardEditorMounted,
    setAreaDraftStale,
    setSelectedId,
    setImportNotice,
    libraryNotes,
    closeAreaEditor,
    setCreationChoices,
    workspaceRef,
    setEditingAreaId,
    setAreaTitle,
    setAreaColor,
    setAddingArea,
  } = model;
  async function createArea(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (libraryMutationPending.current || cardSavePending.current) return;
    const title = areaTitle.trim();
    if (!title) return;
    const id = areaEditor.current.id ?? createAreaId(crypto.randomUUID());
    areaEditor.current.id = id;
    const generation = areaEditor.current.generation;
    const command: WorkspaceAuthoringCommand = {
      kind: "save-area",
      mode: editingAreaId ? "edit" : "create",
      id,
      title,
      color: areaColor,
    };
    libraryMutationPending.current = true;
    setLibraryMutation("area-save");
    setAreaEditorError(null);
    const result = await Effect.runPromise(
      Effect.either(saveAuthoringCommand(command, areaEditor.current.baseline)),
    );
    libraryMutationPending.current = false;
    if (!cardEditorMounted.current || areaEditor.current.generation !== generation) return;
    setLibraryMutation(null);
    if (Either.isLeft(result)) {
      setAreaDraftStale(result.left.reason === "stale-content");
      setAreaEditorError(
        result.left.reason === "stale-content" ? staleAreaDraftMessage : result.left.message,
      );
      return;
    }
    setSelectedId(id);
    setImportNotice(editingAreaId ? `${title} updated.` : `${title} created.`);
    const created = !editingAreaId;
    libraryNotes.update((notes) =>
      discardLibraryDraft(notes, editingAreaId ? `area:${editingAreaId}` : "new-area"),
    );
    closeAreaEditor();
    if (created) setCreationChoices(true);
  }
  function editArea(target: LearningArea) {
    if (libraryMutationPending.current || cardSavePending.current) return;
    const current = workspaceRef.current;
    const latest = current.areas.find((item) => item.id === target.id);
    if (!latest) return;
    areaEditor.current = {
      generation: areaEditor.current.generation + 1,
      id: latest.id,
      baseline: areaEditingBaseline(current, latest),
    };
    setEditingAreaId(latest.id);
    setAreaTitle(latest.title);
    setAreaColor(latest.color);
    setAreaEditorError(null);
    setAreaDraftStale(false);
    setAddingArea(true);
  }
  function addArea() {
    if (libraryMutationPending.current || cardSavePending.current) return;
    closeAreaEditor();
    setAddingArea(true);
  }
  return { createArea, editArea, addArea } as const;
}
