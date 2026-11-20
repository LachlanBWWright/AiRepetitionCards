import { NativeCollapsibleTrigger } from "@recall/ui-native";
import { useEquationEditor } from "@recall/react";
import { cardEquationError } from "@recall/infra-rich-content";
import { NativeEquationEditor } from "./NativeEquationEditor";
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
  readonly maxLength?: number;
  readonly onEdit?: (edit: RichEdit) => void;
};
const actions = [
  ["bold", "Bold", "B"],
  ["italic", "Italic", "I"],
  ["code", "Code", "</>"],
  ["bullet", "Bulleted list", "•"],
  ["number", "Numbered list", "1."],
] as const satisfies readonly (readonly [RichInsertion, string, string])[];
export function NativeRichFormattingToolbar({
  value,
  onChange,
  disabled,
  media = [],
  showPreview = true,
  selection = { start: value.length, end: value.length },
  onEdit,
  maxLength,
}: Props) {
  const equation = useEquationEditor(cardEquationError);
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
            variant="secondary"
            className="min-w-11"

            disabled={disabled ?? false}
            onPress={() => {
              apply(formatRichSelection(value, selection, kind));
            }}
          />
        ))}
        <NativeButton
          label="∑"
          accessibilityLabel="Equation"
          variant="secondary"
          disabled={disabled ?? false}
          onPress={() => {
            equation.open(value, selection, maxLength);
          }}
        />
        {showPreview && (
          <NativeCollapsibleTrigger
            open={preview}
            title="Preview"
            onToggle={() => {
              setPreview(!preview);
            }}
          />
        )}
      </View>
      <NativeEquationEditor
        editor={equation}
        disabled={disabled ?? false}
        onInsert={() => {
          const edit = equation.edit();
          if (!edit) return;
          apply(edit);
          equation.close();
        }}
      />
      {media
        .filter((item) => item.mimeType.startsWith("image/"))
        .map((item, index) => (
          <NativeButton
            key={item.id}
            label={`Insert attached image ${String(index + 1)}`}
            variant="secondary"

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
