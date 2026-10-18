import { NativeWorkspaceCreation } from "../NativeWorkspaceCreation";
import { NativeWorkspaceDeckPicker } from "../library/NativeWorkspaceDeckPicker";
import { NativeWorkspaceDrafts } from "../drafts/NativeWorkspaceDrafts";
import { NativeWorkspaceNotices } from "../NativeWorkspaceNotices";

import type { ComponentProps } from "react";
import type { NativeWorkspaceAuthoringController } from "../useNativeWorkspaceAuthoringController";
export function createAuthoringOverview(
  input: Pick<
    NativeWorkspaceAuthoringController,
    | "workspace"
    | "notes"
    | "area"
    | "now"
    | "locked"
    | "disabledReason"
    | "message"
    | "notesLoaded"
    | "onRetainDraft"
    | "onSelectDeck"
    | "onStudy"
    | "onImportCards"
    | "onGenerateCards"
    | "pendingOpen"
    | "creationChoices"
    | "setCreationChoices"
    | "setPendingOpen"
    | "keepDraftAndClose"
    | "onDiscardCurrentDraft"
    | "resumeDraft"
    | "retainCurrentDraft"
    | "areaEditor"
    | "cardEditor"
    | "open"
  >,
) {
  const {
    workspace,
    notes,
    area,
    now,
    locked,
    disabledReason,
    message,
    notesLoaded,
    onRetainDraft,
    onSelectDeck,
    onStudy,
    onImportCards,
    onGenerateCards,
    pendingOpen,
    creationChoices,
    setCreationChoices,
    setPendingOpen,
    keepDraftAndClose,
    onDiscardCurrentDraft,
    resumeDraft,
    retainCurrentDraft,
    areaEditor,
    cardEditor,
    open,
  } = input;
  return {
    drafts: {
      pendingOpen,
      drafts: notes.drafts,
      notesLoaded,
      canRetainDraft: Boolean(onRetainDraft),
      locked,
      onContinueEditing: () => {
        setPendingOpen(null);
      },
      onKeepDraftAndClose: async () => {
        await keepDraftAndClose();
      },
      onDiscardDraft: () => {
        onDiscardCurrentDraft();
      },
      onResumeDraft: resumeDraft,
    } satisfies ComponentProps<typeof NativeWorkspaceDrafts>,
    deckPicker: {
      locked,
      workspace,
      now,
      onSelectDeck,
      onStudy,
      onRetainCurrentDraft: retainCurrentDraft,
    } satisfies ComponentProps<typeof NativeWorkspaceDeckPicker>,
    notices: {
      message,
      disabledReason,
    } satisfies ComponentProps<typeof NativeWorkspaceNotices>,
    creation: {
      locked,
      area,
      onImportCards,
      onGenerateCards,
      creationChoices,
      setCreationChoices,
      onCreateArea: () => {
        open(areaEditor("create"));
      },
      onCreateCard: () => {
        open(cardEditor());
      },
    } satisfies ComponentProps<typeof NativeWorkspaceCreation>,
  };
}
