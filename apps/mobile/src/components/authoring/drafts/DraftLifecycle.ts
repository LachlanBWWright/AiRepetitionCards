import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import type { LibraryDraft } from "@recall/application";
import type { Workspace } from "@recall/domain";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import type { NativeWorkspaceAuthoringPanelProps } from "../NativeWorkspaceAuthoringPanel.types";
import { snapshotLibraryDraft } from "./DraftSnapshot";
import { flushDraftBeforeClose, resumeLibraryDraft } from "./DraftWorkflow";

export function useDraftLifecycle(input: {
  readonly editor: Editor | null;
  readonly workspace: Workspace | null;
  readonly notesLoaded: boolean;
  readonly onRetainDraft: NativeWorkspaceAuthoringPanelProps["onRetainDraft"];
  readonly onFlushDraft: (() => Promise<boolean>) | undefined;
  readonly onDiscardDraft: ((key: string) => void) | undefined;
  readonly onSelectDeck: ((id: string) => void) | undefined;
  readonly pendingOpen: { readonly next: Editor | null } | null;
  readonly setPendingOpen: Dispatch<SetStateAction<{ readonly next: Editor | null } | null>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly open: (editor: Editor | null) => void;
  readonly openDirectly: (editor: Editor | null) => void;
}) {
  const {
    editor,
    workspace,
    notesLoaded,
    onRetainDraft,
    onFlushDraft,
    onSelectDeck,
    pendingOpen,
    setPendingOpen,
    setMessage,
    open,
    openDirectly,
  } = input;
  const snapshotDraft = useCallback(
    () => snapshotLibraryDraft(editor, workspace),
    [editor, workspace],
  );
  function retainCurrentDraft() {
    const draft = snapshotDraft();
    if (draft)
      onRetainDraft?.(draft, editor?.kind === "card" ? editor.stagedAssets : ([] as const));
  }
  useEffect(() => {
    if (!notesLoaded || !onRetainDraft || !editor) return;
    const timer = setTimeout(() => {
      const draft = snapshotDraft();
      if (draft) onRetainDraft(draft, editor.kind === "card" ? editor.stagedAssets : []);
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [snapshotDraft, editor, onRetainDraft, notesLoaded]);
  async function keepDraftAndClose() {
    const request = pendingOpen;
    if (!request) return;
    if (!(await flushDraftBeforeClose(onFlushDraft, retainCurrentDraft, setMessage))) return;
    setPendingOpen(null);
    openDirectly(request.next);
  }
  function resumeDraft(draft: LibraryDraft) {
    resumeLibraryDraft(draft, { workspace, open, setMessage, onSelectDeck });
  }
  return { snapshotDraft, retainCurrentDraft, keepDraftAndClose, resumeDraft };
}
