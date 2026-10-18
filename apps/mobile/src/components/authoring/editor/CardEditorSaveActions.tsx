import { NativeButton } from "../../ui/NativeButton";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";

type CardEditor = Extract<Editor, { readonly kind: "card" }>;

export type CardEditorSaveActionsProps = {
  readonly editor: CardEditor;
  readonly locked: boolean;
  readonly pending: boolean;
  readonly saveCard: (continueAdding: boolean) => void;
};

export function CardEditorSaveActions({
  editor,
  locked,
  pending,
  saveCard,
}: CardEditorSaveActionsProps) {
  return (
    <>
      {editor.mode === "create" && (
        <NativeButton
          label="Save and add another"
          disabled={locked}
          onPress={() => {
            saveCard(true);
          }}
        />
      )}
      <NativeButton
        label={pending ? "Saving…" : editor.mode === "create" ? "Save and finish" : "Save changes"}
        tone="soft"
        disabled={locked}
        onPress={() => {
          saveCard(false);
        }}
      />
    </>
  );
}
