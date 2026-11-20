import { equationExamples } from "@recall/application";
import type { useEquationEditor } from "@recall/react";
import { NativeButton, NativeSelect, NativeTextField } from "@recall/ui-native";
import { Text, View } from "react-native";
import { NativeCardEquation } from "./NativeCardEquation";

export function NativeEquationEditor({
  editor,
  onInsert,
  disabled,
}: {
  readonly editor: ReturnType<typeof useEquationEditor>;
  readonly onInsert: () => void;
  readonly disabled: boolean;
}) {
  if (!editor.draft) return null;
  return (
    <View
      className="gap-3 rounded-lg border border-recall-line p-3"
      accessibilityLabel="Equation editor"
    >
      <Text className="font-bold text-recall-ink">Equation editor</Text>
      <NativeSelect
        label="Equation layout"
        value={editor.draft.display ? "display" : "inline"}
        disabled={disabled}
        options={[
          { value: "inline", label: "Inline · within a sentence" },
          { value: "display", label: "Display · on its own line" },
        ]}
        onValueChange={(value) => {
          editor.setDisplay(value === "display");
        }}
      />
      <NativeSelect
        label="Equation example"
        value="choose"
        disabled={disabled}
        options={[
          { value: "choose", label: "Choose an example…" },
          ...equationExamples.map((example) => ({ value: example.label, label: example.label })),
        ]}
        onValueChange={(value) => {
          const example = equationExamples.find((item) => item.label === value);
          if (example) editor.setSource(example.source);
        }}
      />
      <NativeTextField
        label="TeX equation"
        value={editor.draft.source}
        onChangeText={editor.setSource}
        editable={!disabled}
        multiline
        maxLength={4000}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <NativeCardEquation source={editor.draft.source} display={editor.draft.display} />
      <Text accessibilityLiveRegion="polite" className="text-sm text-recall-muted">
        {editor.pending
          ? "Updating preview…"
          : (editor.error ??
            (editor.draft.source.trim()
              ? "Equation is ready to insert."
              : "Enter an equation or choose an example to begin."))}
      </Text>
      <NativeButton
        label="Insert equation"
        disabled={disabled || !editor.canInsert}
        onPress={onInsert}
      />
      <NativeButton label="Cancel equation" variant="secondary" onPress={editor.close} />
    </View>
  );
}
