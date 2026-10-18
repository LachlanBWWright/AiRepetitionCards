import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";

export type CardEditorField = (
  label: string,
  value: string,
  onChangeText: (value: string) => void,
  multiline?: boolean,
  maxLength?: number,
) => ReactNode;

export type NativeWorkspaceCardEditorProps = {
  readonly editor: Extract<Editor, { readonly kind: "card" }>;
  readonly locked: boolean;
  readonly field: CardEditorField;
  readonly setEditor: (editor: Editor) => void;
  readonly assistancePanel: ReactNode;
  readonly detailsPanel: ReactNode;
  readonly confirmationPanel: ReactNode;
  readonly saveActions: ReactNode;
};

export function NativeWorkspaceCardEditor({
  editor,
  locked,
  field,
  setEditor,
  assistancePanel,
  detailsPanel,
  confirmationPanel,
  saveActions,
}: NativeWorkspaceCardEditorProps) {
  function changeDeletionIndex(index: string) {
    setEditor({
      ...editor,
      content: {
        ...editor.content,
        cloze: {
          text: editor.content.cloze?.text ?? "",
          deletionIndex: Number(index),
        },
      },
    });
  }
  function changeClozeText(text: string) {
    setEditor({
      ...editor,
      content: {
        ...editor.content,
        cloze: { text, deletionIndex: editor.content.cloze?.deletionIndex ?? 1 },
      },
    });
  }
  function changeKind(kind: "basic" | "cloze") {
    setEditor({
      ...editor,
      content: {
        ...editor.content,
        kind,
        ...(kind === "cloze" && !editor.content.cloze
          ? { cloze: { text: "", deletionIndex: 1 } }
          : {}),
      },
    });
  }
  return (
    <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
      <Text className={"text-recall-ink text-[16px] font-bold"}>
        {editor.mode === "create" ? "New card" : "Edit card"}
      </Text>
      <View className={"flex-row gap-[8px]"}>
        {(["basic", "cloze"] as const).map((kind) => (
          <Pressable
            key={kind}
            disabled={locked}
            accessibilityRole="radio"
            accessibilityState={{ selected: editor.content.kind === kind, disabled: locked }}
            className={"p-[10px] bg-recall-surface rounded-[8px]"}
            onPress={() => {
              changeKind(kind);
            }}
          >
            <Text>{kind === "basic" ? "Basic" : "Cloze"}</Text>
          </Pressable>
        ))}
      </View>
      {editor.content.kind === "basic" ? (
        <>
          {field(
            "Question",
            editor.content.front,
            (front) => {
              setEditor({ ...editor, content: { ...editor.content, front } });
            },
            true,
          )}
          {field(
            "Answer",
            editor.content.back,
            (back) => {
              setEditor({ ...editor, content: { ...editor.content, back } });
            },
            true,
          )}
        </>
      ) : (
        <>
          {field("Cloze text", editor.content.cloze?.text ?? "", changeClozeText, true, 20000)}
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            {"Example: Mitochondria produce {{c1::ATP::energy molecule}}."}
          </Text>
          {field(
            "Deletion index",
            String(editor.content.cloze?.deletionIndex ?? 1),
            changeDeletionIndex,
          )}
        </>
      )}
      {assistancePanel}
      {detailsPanel}
      {confirmationPanel}
      {saveActions}
    </View>
  );
}
