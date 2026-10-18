import { Either, Effect } from "effect";
import {
  findCardDuplicates,
  refinementCardContent,
  workspaceDuplicateCandidates,
} from "@recall/application";
import type { CardRefinementResult } from "@recall/ai-core";
import type { Workspace } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import type { Dispatch, SetStateAction } from "react";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";

type RefinementDependencies = {
  readonly editor: Editor | null;
  readonly locked: boolean;
  readonly workspace: Workspace | null;
  readonly createId: () => string;
  readonly onCommand: (
    command: unknown,
    expectedBaseline?: string,
    assets?: readonly StoredMediaAsset[],
  ) => Promise<{ readonly ok: boolean; readonly message: string }>;
  readonly parseTags: (
    value: string,
  ) => ReturnType<typeof import("@recall/application").parseTagInput>;
  readonly submitGuard: { enter: () => boolean; leave: () => void };
  readonly editorGeneration: { current: number };
  readonly mounted: { current: boolean };
  readonly saveActive: { current: boolean };
  readonly setEditor: Dispatch<SetStateAction<Editor | null>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly setRefinementDuplicate: Dispatch<
    SetStateAction<{
      readonly result: CardRefinementResult;
      readonly key: string;
      readonly descriptions: readonly string[];
    } | null>
  >;
  readonly setPending: Dispatch<SetStateAction<boolean>>;
  readonly setConfirmation: Dispatch<SetStateAction<string>>;
};

export async function applyCardRefinement(
  dependencies: RefinementDependencies,
  result: CardRefinementResult,
  acceptedKey?: string,
): Promise<boolean> {
  const {
    editor,
    locked,
    workspace,
    createId,
    onCommand,
    parseTags,
    submitGuard,
    editorGeneration,
    mounted,
    saveActive,
    setEditor,
    setMessage,
    setRefinementDuplicate,
    setPending,
    setConfirmation,
  } = dependencies;
  if (editor?.kind !== "card" || locked || !submitGuard.enter()) return false;
  const generation = editorGeneration.current;
  const tags = parseTags(editor.tagsText);
  if (Either.isLeft(tags)) {
    setMessage(tags.left.message);
    submitGuard.leave();
    return false;
  }
  const converted = Effect.runSync(
    Effect.either(
      Effect.all(
        result.cards.map((card) =>
          refinementCardContent(card, { ...editor.content, tags: tags.right }),
        ),
      ),
    ),
  );
  if (Either.isLeft(converted)) {
    setMessage(converted.left.message);
    submitGuard.leave();
    return false;
  }
  const first = converted.right[0];
  if (!first) {
    submitGuard.leave();
    return false;
  }
  if (
    converted.right.length === 1 &&
    result.cards[0]?.meaningChanged === false &&
    first.kind === editor.content.kind
  ) {
    setEditor({ ...editor, content: first });
    setMessage("Refinement applied to your draft. Save the card to keep the wording change.");
    submitGuard.leave();
    return true;
  }
  const proposedCandidates = converted.right.map((content, index) => ({
    id: `proposed:${String(index)}`,
    front: content.front,
    back: content.back,
    ...(content.cloze ? { cloze: content.cloze } : {}),
  }));
  const checks = converted.right.flatMap((content, index) =>
    findCardDuplicates(
      {
        front: content.front,
        back: content.back,
        ...(content.cloze ? { cloze: content.cloze } : {}),
      },
      [
        ...(workspace
          ? workspaceDuplicateCandidates(workspace).filter(
              (candidate) => candidate.id !== editor.id,
            )
          : []),
        ...proposedCandidates.filter((_candidate, candidateIndex) => candidateIndex < index),
      ],
      { limit: 5 },
    ),
  );
  const comparisonKey = JSON.stringify([editor.id, editor.content, result, checks]);
  if (checks.length > 0 && acceptedKey !== comparisonKey) {
    setRefinementDuplicate({
      result,
      key: comparisonKey,
      descriptions: checks.map((match) => `${match.candidate.front} · ${match.reason}`),
    });
    setMessage("This refinement overlaps existing cards. Review the matches before keeping both.");
    submitGuard.leave();
    return false;
  }
  setRefinementDuplicate(null);
  const cards = converted.right.map((content) => ({ cardId: createId(), content }));
  const command =
    editor.mode === "edit"
      ? { kind: "replace-card", areaId: editor.areaId, cardId: editor.id, cards }
      : { kind: "create-cards", areaId: editor.areaId, cards };
  saveActive.current = true;
  setPending(true);
  const saved = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: () => onCommand(command, editor.baseline, editor.stagedAssets),
        catch: () => ({
          message: "This refinement could not be saved. Your draft remains available.",
        }),
      }),
    ),
  );
  saveActive.current = false;
  submitGuard.leave();
  if (!mounted.current || editorGeneration.current !== generation) return false;
  setPending(false);
  if (Either.isLeft(saved)) {
    setMessage(saved.left.message);
    return false;
  }
  setMessage(saved.right.message);
  if (saved.right.ok) {
    setEditor(null);
    setConfirmation("");
  }
  return saved.right.ok;
}
