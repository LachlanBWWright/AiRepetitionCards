import { formatTagInput } from "@recall/application";
import type { Workspace } from "@recall/domain";
import type { Dispatch, SetStateAction } from "react";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import type { CardRefinementResult } from "@recall/ai-core";
import type { CounterAccess, RefAccess } from "../RefAccess";

type Dependencies = {
  readonly locked: boolean;
  readonly disabled: boolean;
  readonly bulkAction: "tags" | "move" | "delete" | null;
  readonly saveActive: RefAccess<boolean>;
  readonly pickerToken: RefAccess<number | null>;
  readonly editorGeneration: CounterAccess;
  readonly workspace: Workspace | null;
  readonly bound: (command: unknown) => { readonly baseline?: string };
  readonly snapshotDraft: () => object | null;
  readonly retainCurrentDraft: () => void;
  readonly setPendingOpen: Dispatch<SetStateAction<{ readonly next: Editor | null } | null>>;
  readonly setEditor: Dispatch<SetStateAction<Editor | null>>;
  readonly setPicking: Dispatch<SetStateAction<boolean>>;
  readonly setConfirmation: Dispatch<SetStateAction<string>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly setAreaMenu: Dispatch<SetStateAction<boolean>>;
  readonly setCardMenuId: Dispatch<SetStateAction<string | null>>;
  readonly setShowCardDetails: Dispatch<SetStateAction<boolean>>;
  readonly setRefinementDuplicate: Dispatch<
    SetStateAction<{
      readonly result: CardRefinementResult;
      readonly key: string;
      readonly descriptions: readonly string[];
    } | null>
  >;
};

export function createEditorTransitions(dependencies: Dependencies) {
  const {
    locked,
    disabled,
    bulkAction,
    saveActive,
    pickerToken,
    editorGeneration,
    workspace,
    bound,
    setEditor,
    setPicking,
    setConfirmation,
    setMessage,
    setAreaMenu,
    setCardMenuId,
    setShowCardDetails,
    setRefinementDuplicate,
    snapshotDraft,
    retainCurrentDraft,
    setPendingOpen,
  } = dependencies;

  function openDirectly(next: Editor | null) {
    setAreaMenu(false);
    setCardMenuId(null);
    setShowCardDetails(false);
    setRefinementDuplicate(null);
    if (disabled || saveActive.get() || (pickerToken.get() !== null && next !== null)) return;
    editorGeneration.increment();
    pickerToken.set(null);
    setPicking(false);
    setEditor(next);
    setConfirmation("");
    setMessage(null);
  }

  function open(next: Editor | null) {
    if (locked) return;
    if (bulkAction) {
      setMessage("Finish or cancel the bulk action before opening an editor.");
      return;
    }
    if (snapshotDraft()) {
      retainCurrentDraft();
      setPendingOpen({ next });
      return;
    }
    openDirectly(next);
  }

  function openExistingCard(areaId: string, cardId: string, includeSource: boolean) {
    const foundArea = workspace?.areas.find((item) => item.id === areaId);
    const card = foundArea?.cards.find((item) => item.id === cardId);
    if (!foundArea || !card) return;
    open({
      kind: "card",
      mode: "edit",
      areaId: foundArea.id,
      id: card.id,
      tagsText: formatTagInput(card.tags ?? []),
      stagedAssets: [],
      ...(includeSource ? { sourceCard: card } : {}),
      content: {
        kind: card.cloze ? "cloze" : "basic",
        front: card.front,
        back: card.back,
        ...(card.cloze ? { cloze: card.cloze } : {}),
        objectiveIds: card.objectiveIds ?? [],
        tags: card.tags ?? [],
        media: card.media ?? [],
        presentation: card.presentation,
      },
      ...bound({ kind: "delete-card", areaId: foundArea.id, cardId: card.id }),
    });
  }

  return { open, openDirectly, openExistingCard };
}
