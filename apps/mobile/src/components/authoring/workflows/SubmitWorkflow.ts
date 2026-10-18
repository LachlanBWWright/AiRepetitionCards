import { Effect } from "effect";
import type { LibraryDraft } from "@recall/application";
import type { CardRefinementResult } from "@recall/ai-core";
import type { StoredMediaAsset } from "@recall/local-store";
import type { Dispatch, SetStateAction } from "react";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import { emptyContent } from "../NativeWorkspaceAuthoringPanel.types";
import type { CounterAccess, RefAccess } from "../RefAccess";

type SubmitGuard = { enter: () => boolean; leave: () => void };
type SaveResult = { readonly ok: boolean; readonly message: string };
type Dependencies = {
  readonly disabled: boolean;
  readonly pickerToken: RefAccess<number | null>;
  readonly submitGuard: SubmitGuard;
  readonly saveActive: RefAccess<boolean>;
  readonly editorGeneration: CounterAccess;
  readonly editor: Editor | null;
  readonly onCommand: (
    command: unknown,
    baseline?: string,
    assets?: readonly StoredMediaAsset[],
  ) => Promise<SaveResult>;
  readonly mounted: RefAccess<boolean>;
  readonly setPending: Dispatch<SetStateAction<boolean>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly setPendingOpen: Dispatch<SetStateAction<{ readonly next: Editor | null } | null>>;
  readonly snapshotDraft: () => LibraryDraft | null;
  readonly onDiscardDraft: ((key: string) => void) | undefined;
  readonly bulkAction: string | null;
  readonly setBulkAction: Dispatch<SetStateAction<"tags" | "move" | "delete" | null>>;
  readonly setSelectedCards: Dispatch<SetStateAction<readonly string[]>>;
  readonly setBulkRequest: Dispatch<
    SetStateAction<{ readonly command: unknown; readonly baseline?: string } | null>
  >;
  readonly setCreationChoices: Dispatch<SetStateAction<boolean>>;
  readonly setKeptDuplicateDraft: Dispatch<SetStateAction<string | null>>;
  readonly setShowCardDetails: Dispatch<SetStateAction<boolean>>;
  readonly setRefinementDuplicate: Dispatch<
    SetStateAction<{
      readonly result: CardRefinementResult;
      readonly key: string;
      readonly descriptions: readonly string[];
    } | null>
  >;
  readonly setEditor: Dispatch<SetStateAction<Editor | null>>;
  readonly createId: () => string;
  readonly setConfirmation: Dispatch<SetStateAction<string>>;
};

export function createSubmitWorkflow(dependencies: Dependencies) {
  const {
    disabled,
    pickerToken,
    submitGuard,
    saveActive,
    editorGeneration,
    editor,
    onCommand,
    mounted,
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
  } = dependencies;

  function handleSuccess(result: SaveResult, generation: number, continueAdding: boolean) {
    if (!mounted.get() || editorGeneration.get() !== generation) return;
    setMessage(result.message);
    if (!result.ok) return;
    setPendingOpen(null);
    const draft = snapshotDraft();
    if (draft) onDiscardDraft?.(draft.key);
    if (bulkAction) {
      setBulkAction(null);
      setSelectedCards([]);
      setBulkRequest(null);
    }
    if (editor?.kind === "area" && editor.mode === "create") setCreationChoices(true);
    if (continueAdding && editor?.kind === "card" && editor.mode === "create") {
      editorGeneration.increment();
      setKeptDuplicateDraft(null);
      setShowCardDetails(false);
      setRefinementDuplicate(null);
      setEditor({
        kind: "card",
        mode: "create",
        areaId: editor.areaId,
        id: createId(),
        stagedAssets: [],
        tagsText: "",
        content: {
          ...emptyContent,
          kind: editor.content.kind,
          ...(editor.content.kind === "cloze" ? { cloze: { text: "", deletionIndex: 1 } } : {}),
        },
      });
      setMessage("Card saved. Add your next card.");
    } else setEditor(null);
    setConfirmation("");
  }

  return function submit(command: unknown, expectedBaseline?: string, continueAdding = false) {
    if (disabled || pickerToken.get() !== null || !submitGuard.enter()) return;
    saveActive.set(true);
    const generation = editorGeneration.get();
    const assets =
      editor?.kind === "card"
        ? editor.stagedAssets.filter((asset) =>
            editor.content.media.some((reference) => reference.id === asset.reference.id),
          )
        : [];
    setPending(true);
    setMessage(null);
    Effect.runFork(
      Effect.tryPromise({
        try: () => onCommand(command, expectedBaseline, assets),
        catch: () => ({ _tag: "AuthoringPersistenceFailure" }) as const,
      }).pipe(
        Effect.match({
          onFailure: () => {
            if (mounted.get() && editorGeneration.get() === generation)
              setMessage("This change could not be saved. Your draft remains here; try again.");
          },
          onSuccess: (result) => {
            handleSuccess(result, generation, continueAdding);
          },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            submitGuard.leave();
            saveActive.set(false);
            if (mounted.get()) setPending(false);
          }),
        ),
      ),
    );
  };
}
