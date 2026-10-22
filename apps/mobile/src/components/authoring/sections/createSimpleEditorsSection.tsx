import { createNativeWorkspaceField } from "../editor/NativeWorkspaceField";
import { NativeWorkspaceSimpleEditors } from "../settings/NativeWorkspaceSimpleEditors";

import type { ComponentProps } from "react";
import type { NativeWorkspaceAuthoringController } from "../useNativeWorkspaceAuthoringController";
export function createSimpleEditorsSection(
  input: Pick<
    NativeWorkspaceAuthoringController,
    "workspace" | "locked" | "pending" | "editor" | "setEditor" | "setMessage" | "submit"
  >,
) {
  const { workspace, locked, pending, editor, setEditor, setMessage, submit } = input;
  const field = createNativeWorkspaceField(editor, locked);
  const props: ComponentProps<typeof NativeWorkspaceSimpleEditors> = {
    editor,
    workspace,
    locked,
    pending,
    field,
    setEditor: (next) => {
      setEditor(next);
    },
    setMessage: (next) => {
      setMessage(next);
    },
    submit,
  };
  return props;
}
