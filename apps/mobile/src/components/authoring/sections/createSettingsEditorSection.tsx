import { createNativeWorkspaceField } from "../editor/NativeWorkspaceField";
import { NativeWorkspaceSettingsEditor } from "../settings/NativeWorkspaceSettingsEditor";

import type { ComponentProps } from "react";
import type { NativeWorkspaceAuthoringController } from "../useNativeWorkspaceAuthoringController";
export function createSettingsEditorSection(
  input: Pick<
    NativeWorkspaceAuthoringController,
    "locked" | "pending" | "editor" | "setEditor" | "setMessage" | "submit" | "createId"
  >,
) {
  const { locked, pending, editor, setEditor, setMessage, submit, createId } = input;
  if (editor?.kind !== "settings") return null;
  const field = createNativeWorkspaceField(editor, locked);
  const props: ComponentProps<typeof NativeWorkspaceSettingsEditor> = {
    editor,
    locked,
    pending,
    field,
    setEditor,
    setMessage,
    submit,
    createId,
  };
  return props;
}
