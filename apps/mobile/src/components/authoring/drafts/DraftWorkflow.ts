import { Either } from "effect";
import { parseTagInput, type LibraryDraft } from "@recall/application";
import { createObjectiveId, type Workspace } from "@recall/domain";
import type { Dispatch, SetStateAction } from "react";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";

type OpenEditor = (editor: Editor | null) => void;

export function resumeLibraryDraft(
  draft: LibraryDraft,
  dependencies: {
    readonly workspace: Workspace | null;
    readonly open: OpenEditor;
    readonly setMessage: Dispatch<SetStateAction<string | null>>;
    readonly onSelectDeck: ((id: string) => void) | undefined;
  },
): void {
  const { workspace, open, setMessage, onSelectDeck } = dependencies;
  if (draft.kind === "area") {
    open({
      kind: "area",
      mode: draft.mode,
      id: draft.id,
      title: draft.title,
      color: draft.color,
      ...(draft.baseline === undefined ? {} : { baseline: draft.baseline }),
    });
    return;
  }
  if (!workspace?.areas.some((item) => item.id === draft.areaId)) {
    setMessage(
      `The draft’s deck no longer exists. Copy the text before discarding: ${draft.front || draft.clozeText} — ${draft.back}`,
    );
    return;
  }
  onSelectDeck?.(draft.areaId);
  const tags = parseTagInput(draft.tagsText);
  open({
    kind: "card",
    mode: draft.mode,
    id: draft.id,
    areaId: draft.areaId,
    tagsText: draft.tagsText,
    stagedAssets: [],
    ...(draft.sourceCard ? { sourceCard: draft.sourceCard } : {}),
    content: {
      kind: draft.cardKind,
      front: draft.front,
      back: draft.back,
      ...(draft.cardKind === "cloze"
        ? { cloze: { text: draft.clozeText, deletionIndex: Number(draft.clozeIndex) } }
        : {}),
      objectiveIds: draft.objectiveIds.map(createObjectiveId),
      media: draft.media,
      tags: Either.isRight(tags) ? tags.right : [],
    },
    ...(draft.baseline === undefined ? {} : { baseline: draft.baseline }),
  });
}

export async function flushDraftBeforeClose(
  flush: (() => Promise<boolean>) | undefined,
  retain: () => void,
  setMessage: Dispatch<SetStateAction<string | null>>,
): Promise<boolean> {
  retain();
  if (flush && !(await flush())) {
    setMessage(
      "The draft couldn’t be saved. Keep editing here or retry draft saving before closing.",
    );
    return false;
  }
  return true;
}
