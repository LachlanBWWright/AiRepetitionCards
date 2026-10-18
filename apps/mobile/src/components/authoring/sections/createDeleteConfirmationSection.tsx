import { DeleteConfirmation } from "../workflows/DeleteConfirmation";
import { createNativeWorkspaceField } from "../editor/NativeWorkspaceField";

import type { ComponentProps } from "react";
import type { NativeWorkspaceAuthoringController } from "../useNativeWorkspaceAuthoringController";
export function createDeleteConfirmationSection(
  input: Pick<
    NativeWorkspaceAuthoringController,
    | "locked"
    | "disabled"
    | "pending"
    | "editor"
    | "open"
    | "submit"
    | "confirmation"
    | "setConfirmation"
  >,
) {
  const { locked, disabled, pending, editor, open, submit, confirmation, setConfirmation } = input;
  const field = createNativeWorkspaceField(editor, locked);
  const props: ComponentProps<typeof DeleteConfirmation> = {
    editor,
    confirmation,
    setConfirmation,
    field,
    locked,
    disabled,
    pending,
    submit,
    onCancel: () => {
      open(null);
    },
  };
  return props;
}
