import { Text, TextInput, View } from "react-native";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";

export type NativeWorkspaceFieldProps = {
  readonly editor: Editor | null;
  readonly locked: boolean;
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly multiline?: boolean;
  readonly maxLength?: number;
};

export function NativeWorkspaceField({
  editor,
  locked,
  label,
  value,
  onChangeText,
  multiline = false,
  maxLength,
}: NativeWorkspaceFieldProps) {
  return (
    <View className="gap-[5px]">
      <Text className="text-recall-ink text-[13px] font-semibold">{label}</Text>
      <TextInput
        key={editor?.kind === "card" ? `${editor.id}:${label}` : label}
        autoFocus={
          editor?.kind === "card" &&
          editor.mode === "create" &&
          (label === "Question" || label === "Cloze text")
        }
        accessibilityLabel={label}
        editable={!locked}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        {...(maxLength === undefined ? {} : { maxLength })}
        className={`min-h-[44px] border border-recall-line rounded-[9px] p-[10px] text-recall-ink bg-recall-surface ${multiline ? "min-h-[90px]" : ""}`}
        style={multiline ? { textAlignVertical: "top" } : undefined}
      />
    </View>
  );
}

/** Bind the shared input renderer to one editor session. */
export function createNativeWorkspaceField(editor: Editor | null, locked: boolean) {
  return function renderField(
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    multiline = false,
    maxLength?: number,
  ) {
    return (
      <NativeWorkspaceField
        editor={editor}
        locked={locked}
        label={label}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        {...(maxLength === undefined ? {} : { maxLength })}
      />
    );
  };
}
