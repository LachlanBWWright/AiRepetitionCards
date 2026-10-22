import type { MediaReference } from "@recall/domain";
import { useState } from "react";
import { View } from "react-native";
import {
  formatRichSelection,
  insertRichText,
  type RichInsertion,
  type RichSelection,
  type RichEdit,
} from "@recall/application";
import { NativeButton } from "../../ui/NativeButton";
import { NativeCardRichText } from "./NativeCardRichText";

type Props = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly media?: readonly MediaReference[];
  readonly showPreview?: boolean;
  readonly selection?: RichSelection;
  readonly onEdit?: (edit: RichEdit) => void;
};
const actions = [
  ["bold", "Bold", "B"],
  ["italic", "Italic", "I"],
  ["code", "Code", "</>"],
  ["bullet", "Bulleted list", "•"],
  ["number", "Numbered list", "1."],
  ["math", "Equation", "∑"],
] as const satisfies readonly (readonly [RichInsertion, string, string])[];
export function NativeRichFormattingToolbar({
  value,
  onChange,
  disabled,
  media = [],
  showPreview = true,
  selection = { start: value.length, end: value.length },
  onEdit,
}: Props) {
  const [preview, setPreview] = useState(false);
  const apply = (edit: RichEdit) => {
    if (onEdit) onEdit(edit);
    else onChange(edit.value);
  };
  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap gap-1">
        {actions.map(([kind, label, glyph]) => (
          <NativeButton
            key={kind}
            label={glyph}
            accessibilityLabel={label}
            tone="soft"
            className="min-h-12 min-w-11 rounded-lg px-2"
            labelClassName={kind === "italic" ? "italic text-base" : "text-base font-medium"}
            disabled={disabled ?? false}
            onPress={() => {
              apply(formatRichSelection(value, selection, kind));
            }}
          />
        ))}
        {showPreview && (
          <NativeButton
            label={preview ? "Hide preview" : "Preview"}
            tone="soft"
            onPress={() => {
              setPreview(!preview);
            }}
          />
        )}
      </View>
      {media
        .filter((item) => item.mimeType.startsWith("image/"))
        .map((item, index) => (
          <NativeButton
            key={item.id}
            label={`Insert attached image ${String(index + 1)}`}
            tone="soft"
            className="min-h-10 rounded-lg px-3"
            labelClassName="text-xs font-medium"
            disabled={disabled ?? false}
            onPress={() => {
              apply(
                insertRichText(value, selection, `![Image ${String(index + 1)}](media:${item.id})`),
              );
            }}
          />
        ))}

      {showPreview && preview && <NativeCardRichText text={value} />}
    </View>
  );
}
