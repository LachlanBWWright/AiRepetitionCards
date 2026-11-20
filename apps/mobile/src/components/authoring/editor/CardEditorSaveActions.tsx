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
      <NativeButton
        label={pending ? "Saving card…" : editor.mode === "create" ? "Save card" : "Save changes"}
        variant="default"
        disabled={locked}
        onPress={() => {
          saveCard(false);
        }}
      />
      {editor.mode === "create" && (
        <NativeButton
          label="Save & add another"
          variant="secondary"
          disabled={locked}
          onPress={() => {
            saveCard(true);
          }}
        />
      )}
    </>
  );
}
