import { CardAssistance } from "../editor/CardAssistance";
import { CardEditorDetails } from "../editor/CardEditorDetails";
import { CardEditorDuplicateConfirmations } from "../editor/CardEditorDuplicateConfirmations";
import { CardEditorSaveActions } from "../editor/CardEditorSaveActions";
import { NativeWorkspaceCardEditor } from "../editor/NativeWorkspaceCardEditor";
import { createNativeWorkspaceField } from "../editor/NativeWorkspaceField";

import type { ComponentProps } from "react";
import type { NativeWorkspaceAuthoringController } from "../useNativeWorkspaceAuthoringController";

export function createCardEditorSection(
  input: Pick<
    NativeWorkspaceAuthoringController,
    | "mediaStore"
    | "createId"
    | "locked"
    | "pending"
    | "picking"
    | "editor"
    | "setEditor"
    | "setMessage"
    | "tutorApi"
    | "refinementDuplicate"
    | "applyRefinement"
    | "showCardDetails"
    | "setShowCardDetails"
    | "onPickAttachment"
    | "pickAttachment"
    | "setRefinementDuplicate"
    | "setKeptDuplicateDraft"
    | "saveCard"
    | "viewData"
  >,
) {
  const {
    mediaStore,
    createId,
    locked,
    pending,
    picking,
    editor,
    setEditor,
    setMessage,
    tutorApi,
    refinementDuplicate,
    applyRefinement,
    showCardDetails,
    setShowCardDetails,
    onPickAttachment,
    pickAttachment,
    setRefinementDuplicate,
    setKeptDuplicateDraft,
    saveCard,
    viewData,
  } = input;
  const {
    editorArea,
    assistanceArea,
    assistanceContent,
    draftDuplicates,
    duplicateDraftKey,
    duplicatesAccepted,
  } = viewData;
  if (editor?.kind !== "card") return null;

  const field = createNativeWorkspaceField(editor, locked);
  const handlePickAttachment = onPickAttachment
    ? () => {
        void pickAttachment();
      }
    : undefined;
  const props: ComponentProps<typeof NativeWorkspaceCardEditor> = {
    editor,
    ...(mediaStore ? { mediaStore } : {}),
    createId,
    locked,
    field,
    setEditor,
    assistancePanel: (
      <CardAssistance
        editorId={editor.id}
        content={assistanceContent}
        assistanceArea={assistanceArea}
        tutorApi={tutorApi}
        disabled={locked}
        onApply={applyRefinement}
        onError={setMessage}
      />
    ),
    detailsPanel: (
      <CardEditorDetails
        editor={editor}
        locked={locked}
        field={field}
        setEditor={setEditor}
        editorArea={editorArea}
        showCardDetails={showCardDetails}
        setShowCardDetails={setShowCardDetails}
        onPickAttachment={handlePickAttachment}
        picking={picking}
        pickAttachment={pickAttachment}
      />
    ),
    confirmationPanel: (
      <CardEditorDuplicateConfirmations
        locked={locked}
        refinementDuplicate={refinementDuplicate}
        applyRefinement={applyRefinement}
        setRefinementDuplicate={setRefinementDuplicate}
        draftDuplicates={draftDuplicates}
        duplicatesAccepted={duplicatesAccepted}
        duplicateDraftKey={duplicateDraftKey}
        setKeptDuplicateDraft={setKeptDuplicateDraft}
      />
    ),
    saveActions: (
      <CardEditorSaveActions
        editor={editor}
        locked={locked}
        pending={pending}
        saveCard={saveCard}
      />
    ),
  };
  return props;
}
