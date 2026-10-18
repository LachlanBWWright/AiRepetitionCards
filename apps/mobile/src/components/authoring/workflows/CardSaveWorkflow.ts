import { Either } from "effect";
import { parseTagInput } from "@recall/application";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";

type Submit = (command: unknown, baseline?: string, continueAdding?: boolean) => void;
type Dependencies = {
  readonly editor: Editor | null;
  readonly duplicateCount: number;
  readonly duplicatesAccepted: boolean;
  readonly setMessage: (message: string) => void;
  readonly submit: Submit;
};

export function createCardSaveWorkflow({
  editor,
  duplicateCount,
  duplicatesAccepted,
  setMessage,
  submit,
}: Dependencies) {
  return function saveCard(continueAdding: boolean): void {
    if (editor?.kind !== "card") return;
    if (duplicateCount > 0 && !duplicatesAccepted) {
      setMessage("Review the similar cards and choose Keep both to save this draft.");
      return;
    }
    const tags = parseTagInput(editor.tagsText);
    if (Either.isLeft(tags)) {
      setMessage(tags.left.message);
      return;
    }
    submit(
      {
        kind: editor.mode === "create" ? "create-card" : "update-card",
        areaId: editor.areaId,
        cardId: editor.id,
        content: { ...editor.content, tags: tags.right },
      },
      editor.baseline,
      continueAdding,
    );
  };
}
