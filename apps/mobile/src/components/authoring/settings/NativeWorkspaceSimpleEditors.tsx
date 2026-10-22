import { NativeSchedulerEditor } from "./NativeSchedulerEditor";
import type { Workspace } from "@recall/domain";
import { Text, View } from "react-native";
import { NativeButton } from "../../ui/NativeButton";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import type { ReactNode } from "react";

type Field = (
  label: string,
  value: string,
  onChangeText: (value: string) => void,
  multiline?: boolean,
  maxLength?: number,
) => ReactNode;
type Submit = (command: unknown, baseline?: string) => void;

export type NativeWorkspaceSimpleEditorsProps = {
  readonly editor: Editor | null;
  readonly workspace: Workspace | null;
  readonly locked: boolean;
  readonly pending: boolean;
  readonly field: Field;
  readonly setEditor: (editor: Editor) => void;
  readonly setMessage: (message: string) => void;
  readonly submit: Submit;
};

export type EditorActions = Omit<NativeWorkspaceSimpleEditorsProps, "editor">;

export function NativeWorkspaceSimpleEditors({
  editor,
  ...actions
}: NativeWorkspaceSimpleEditorsProps) {
  if (editor?.kind === "scheduler") return <NativeSchedulerEditor editor={editor} {...actions} />;
  if (editor?.kind === "area") return <AreaEditor editor={editor} {...actions} />;
  return null;
}

function AreaEditor({
  editor,
  locked,
  pending,
  field,
  setEditor,
  submit,
}: Omit<EditorActions, "setMessage"> & {
  readonly editor: Extract<Editor, { readonly kind: "area" }>;
}) {
  return (
    <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
      <Text className={"text-recall-ink text-[16px] font-bold"}>
        {editor.mode === "create" ? "New subject" : "Edit subject"}
      </Text>
      {field(
        "Subject name",
        editor.title,
        (title) => {
          setEditor({ ...editor, title });
        },
        false,
        80,
      )}
      {field(
        "Color (optional, #RRGGBB)",
        editor.color,
        (color) => {
          setEditor({ ...editor, color });
        },
        false,
        7,
      )}
      {
        <NativeButton
          label={pending ? "Saving…" : editor.mode === "create" ? "Create subject" : "Save changes"}
          tone="soft"
          disabled={locked}
          onPress={() => {
            submit(
              {
                kind: "save-area",
                mode: editor.mode,
                id: editor.id,
                title: editor.title,
                color: editor.color,
              },
              editor.baseline,
            );
          }}
        />
      }
    </View>
  );
}
