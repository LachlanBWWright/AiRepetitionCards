import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { CardRefinementResult } from "@recall/ai-core";
import type { LearningArea, Workspace } from "@recall/domain";
import type { Editor } from "./NativeWorkspaceAuthoringPanel.types";
import { useNativeWorkspaceLibraryState } from "./library/useNativeWorkspaceLibraryState";

export function useNativeWorkspaceAuthoringPanelState(input: {
  readonly setEditorState: Dispatch<SetStateAction<Editor | null>>;
  readonly area: LearningArea | undefined;
  readonly workspace: Workspace | null;
  readonly initialHistory: boolean;
  readonly initialShowDuplicates: boolean;
  readonly initialObjectiveFilter: string | undefined;
  readonly initialSearch: string | undefined;
  readonly initialMessage: string | undefined;
  readonly requestedFlaggedOnly: boolean | undefined;
  readonly onFlaggedFilterChange: ((value: boolean) => void) | undefined;
}) {
  const {
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
  } = input;
  const [refinementDuplicate, setRefinementDuplicate] = useState<{
    readonly result: CardRefinementResult;
    readonly key: string;
    readonly descriptions: readonly string[];
  } | null>(null);
  const [history, setHistory] = useState<{
    readonly areaId?: string;
    readonly cardId?: string;
  } | null>(initialHistory ? {} : null);
  const [showDuplicates, setShowDuplicates] = useState(initialShowDuplicates);
  const [keptDuplicateDraft, setKeptDuplicateDraft] = useState<string | null>(null);
  function setEditor(update: SetStateAction<Editor | null>) {
    setKeptDuplicateDraft(null);
    setEditorState(update);
  }
  const [areaMenu, setAreaMenu] = useState(false);
  const [showCardDetails, setShowCardDetails] = useState(false);

  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState(initialMessage ?? null);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const mounted = useRef(true);
  const editorGeneration = useRef(0);
  const pickerToken = useRef<number | null>(null);
  const saveActive = useRef(false);
  const refAccesses = {
    saveActive: {
      get: () => saveActive.current,
      set: (value: boolean) => {
        saveActive.current = value;
      },
    },
    pickerToken: {
      get: () => pickerToken.current,
      set: (value: number | null) => {
        pickerToken.current = value;
      },
    },
    editorGeneration: {
      get: () => editorGeneration.current,
      increment: () => {
        editorGeneration.current += 1;
      },
    },
    mounted: {
      get: () => mounted.current,
      set: (value: boolean) => {
        mounted.current = value;
      },
    },
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      editorGeneration.current += 1;
    };
  }, []);
  const [submitGuard] = useState(() => {
    let active = false;
    return {
      enter: () => {
        if (active) return false;
        active = true;
        return true;
      },
      leave: () => {
        active = false;
      },
    };
  });
  const [pendingOpen, setPendingOpen] = useState<{ readonly next: Editor | null } | null>(null);
  const libraryState = useNativeWorkspaceLibraryState({
    area,
    workspace,
    initialObjectiveFilter,
    initialSearch,
    requestedFlaggedOnly,
    onFlaggedFilterChange,
  });
  return {
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
    showCardDetails,
    setShowCardDetails,
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
    pickerToken,
    saveActive,
    submitGuard,
    pendingOpen,
    setPendingOpen,
    ...libraryState,
  };
}
