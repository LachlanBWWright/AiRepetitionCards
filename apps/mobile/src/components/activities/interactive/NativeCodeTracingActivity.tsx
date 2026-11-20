import { Text, View } from "react-native";
import { NativeTextField } from "@recall/ui-native";
import type { ActivityResponse } from "@recall/domain";

export function NativeCodeTracingActivity({
  code,
  language,
  response,
  disabled,
  onChange,
}: {
  readonly code: string;
  readonly language: string;
  readonly response: ActivityResponse;
  readonly disabled: boolean;
  readonly onChange: (response: ActivityResponse) => void;
}) {
  return (
    <View className="gap-3">
      <Text className="font-bold">Trace this {language} code</Text>
      <Text selectable accessibilityLabel={`${language} source code`} className="font-mono text-sm">
        {code}
      </Text>
      <Text className="text-sm text-recall-muted">
        Predict the output without running the code. Line endings and trailing whitespace are
        ignored; leading spaces and letter case matter.
      </Text>
      <NativeTextField
        label="Predicted output"
        value={response.answers[0] ?? ""}
        onChangeText={(value) => {
          onChange({ ...response, answers: [value], selectedOptionIds: [] });
        }}
        editable={!disabled}
        multiline
        maxLength={40_000}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}
