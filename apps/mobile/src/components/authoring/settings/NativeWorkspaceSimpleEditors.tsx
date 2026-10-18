import { Either, Schema } from "effect";
import { Pressable, Text, View } from "react-native";
import { SchedulerSettingsSchema } from "@recall/domain";
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
  readonly locked: boolean;
  readonly pending: boolean;
  readonly field: Field;
  readonly setEditor: (editor: Editor) => void;
  readonly setMessage: (message: string) => void;
  readonly submit: Submit;
};

type EditorActions = Omit<NativeWorkspaceSimpleEditorsProps, "editor">;

export function NativeWorkspaceSimpleEditors({
  editor,
  ...actions
}: NativeWorkspaceSimpleEditorsProps) {
  if (editor?.kind === "scheduler") return <SchedulerEditor editor={editor} {...actions} />;
  if (editor?.kind === "area") return <AreaEditor editor={editor} {...actions} />;
  return null;
}

function SchedulerEditor({
  editor,
  locked,
  pending,
  field,
  setEditor,
  setMessage,
  submit,
}: EditorActions & {
  readonly editor: Extract<Editor, { readonly kind: "scheduler" }>;
}) {
  return (
    <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
      <Text className={"text-recall-ink text-[16px] font-bold"}>Review settings</Text>
      <Text className={"text-recall-ink text-[13px] font-semibold"}>Remembering target</Text>
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        Choose the chance of remembering a card when it is due. Higher targets mean more frequent
        reviews. Start at 90%.
      </Text>
      {field(
        "Target retention (%) · 70 to 97",
        editor.retentionPercent,
        (retentionPercent) => {
          setEditor({ ...editor, retentionPercent });
        },
        false,
        20,
      )}
      <View className={"flex-row gap-[8px]"}>
        {([70, 90, 97] as const).map((percent) => (
          <Pressable
            key={percent}
            disabled={locked}
            accessibilityRole="button"
            accessibilityState={{
              selected: editor.retentionPercent === String(percent),
              disabled: locked,
            }}
            className={"p-[10px] bg-recall-surface rounded-[8px]"}
            onPress={() => {
              setEditor({ ...editor, retentionPercent: String(percent) });
            }}
          >
            <Text>{percent}%</Text>
          </Pressable>
        ))}
      </View>
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        Applies to future reviews.
      </Text>
      {
        <NativeButton
          label={pending ? "Saving…" : "Save review settings"}
          tone="soft"
          disabled={locked}
          onPress={() => {
            const decoded = Schema.decodeUnknownEither(SchedulerSettingsSchema)({
              requestRetention: Number(editor.retentionPercent) / 100,
            });
            if (Either.isLeft(decoded)) {
              setMessage("Choose a target retention between 70% and 97%.");
              return;
            }
            submit({ kind: "update-scheduler-settings", settings: decoded.right }, editor.baseline);
          }}
        />
      }
    </View>
  );
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
