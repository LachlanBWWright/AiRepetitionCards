import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { RichSelection, RichEdit } from "@recall/application";
import type { MediaReference } from "@recall/domain";
import { NativeRichFormattingToolbar } from "./NativeRichFormattingToolbar";

type Props = {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
  readonly media: readonly MediaReference[];
  readonly maxLength?: number;
  readonly showPreview?: boolean;
  readonly autoFocus?: boolean;
};
export function NativeRichTextEditor({
  label,
  value,
  onChange,
  disabled,
  media,
  maxLength = 20000,
  showPreview = true,
  autoFocus = false,
}: Props) {
  const editor = useRef<TextInput>(null);
  const [selection, setSelection] = useState<RichSelection>({
    start: value.length,
    end: value.length,
  });
  const [replacementSelection, setReplacementSelection] = useState<RichSelection>();
  const apply = (edit: RichEdit) => {
    if (edit.value.length > maxLength) return;
    onChange(edit.value);
    setSelection(edit.selection);
    setReplacementSelection(edit.selection);
    editor.current?.focus();
  };
  return (
    <View className="gap-2">
      <Text className="text-recall-ink text-[13px] font-semibold">{label}</Text>
      <TextInput
        ref={editor}
        accessibilityLabel={label}
        value={value}
        onChangeText={(text) => {
          setReplacementSelection(undefined);
          onChange(text);
        }}
        editable={!disabled}
        multiline
        maxLength={maxLength}
        autoFocus={autoFocus}
        selection={replacementSelection}
        onSelectionChange={(event) => {
          setSelection(event.nativeEvent.selection);
          setReplacementSelection(undefined);
        }}
        className="min-h-[90px] border border-recall-line rounded-[9px] p-[10px] text-recall-ink bg-recall-surface"
        style={{ textAlignVertical: "top" }}
      />
      <NativeRichFormattingToolbar
        value={value}
        onChange={onChange}
        disabled={disabled}
        media={media}
        showPreview={showPreview}
        selection={selection}
        onEdit={apply}
      />
    </View>
  );
}
