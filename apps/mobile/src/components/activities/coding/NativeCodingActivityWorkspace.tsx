import { Text, View } from "react-native";
import { NativeTextField } from "@recall/ui-native";
import type { useLearningActivities } from "@recall/react";
import { NativeCodingRubricFallback } from "./NativeCodingRubricFallback";
import { NativeButton } from "../../ui/NativeButton";

export type NativeCodingActivityWorkspaceProps = {
  readonly model: ReturnType<typeof useLearningActivities>;
  readonly disabled?: boolean;
};

export function NativeCodingActivityWorkspace({
  model,
  disabled = false,
}: NativeCodingActivityWorkspaceProps) {
  const { content, execution, executionMode, message, busy, run, submit } = model.coding;
  if (!content)
    return (
      <View className="gap-3">
        <Text>{model.activity?.fallback}</Text>
        <NativeTextField
          label="Your solution"
          value={model.response.answers[0] ?? ""}
          maxLength={40_000}
          editable={!disabled && !model.result}
          multiline
          onChangeText={(value) => {
            model.answer(0, value);
          }}
        />
        <NativeCodingRubricFallback model={model} disabled={disabled} />
      </View>
    );
  const locked = disabled || busy || model.busy || !!model.result;
  const source = model.response.answers[0] ?? "";
  const hintsShown = (model.response.interaction?.hints ?? 0) > 0;
  return (
    <View className="gap-3">
      <Text>
        {content.language} · {content.mode === "short-review" ? "Short review" : "Practice"} ·
        solve(...inputs)
      </Text>
      {content.prompts.map((prompt, index) => (
        <Text key={index}>{prompt}</Text>
      ))}
      {content.signature && <Text className="font-mono">{content.signature}</Text>}
      {!!content.constraints?.length && (
        <View className="gap-1">
          <Text className="font-bold">Constraints</Text>
          {content.constraints.map((constraint, index) => (
            <Text key={index}>• {constraint}</Text>
          ))}
        </View>
      )}
      <Text className="font-bold">Examples</Text>
      {(content.exampleTests ?? content.tests.slice(0, 1)).map((test, index) => (
        <Text
          key={index}
          className="font-mono"
        >{`Input: ${JSON.stringify(test.input)}\nExpected: ${JSON.stringify(test.expected)}`}</Text>
      ))}
      <NativeTextField
        label={`Your ${content.language} solution`}
        value={source}
        onChangeText={(value) => {
          model.answer(0, value);
        }}
        editable={!locked}
        multiline
        autoCorrect={false}
        autoCapitalize="none"
        maxLength={40_000}
        inputClassName="min-h-64 font-mono"
      />
      {content.starterCode && (
        <NativeButton
          label="Use starter code"
          variant="default"
          disabled={locked || !!source}
          onPress={() => {
            model.answer(0, content.starterCode ?? "");
          }}
        />
      )}
      {!!content.hints?.length && (
        <NativeButton
          label="Show hints (marks assistance)"
          variant="default"
          disabled={locked || hintsShown}
          onPress={() => {
            model.setResponse((current) => ({
              ...current,
              assistance: current.assistance === "none" ? "hint" : current.assistance,
              interaction: {
                ...current.interaction,
                hints: Math.max(1, current.interaction?.hints ?? 0),
              },
            }));
          }}
        />
      )}
      {hintsShown && content.hints?.map((hint, index) => <Text key={index}>{hint}</Text>)}
      <Text>
        Run checks public examples when provided, otherwise downloaded tests. Submit checks all
        downloaded tests. Accept the proposed assessment below to record one attempt. Your code is
        saved with your draft.
      </Text>
      <NativeButton
        label="Run examples"
        variant="default"
        disabled={locked || !source.trim()}
        onPress={run}
      />
      <NativeButton label="Submit solution" disabled={locked || !source.trim()} onPress={submit} />
      <NativeCodingRubricFallback model={model} disabled={locked} />
      {busy && <Text accessibilityRole="alert">Executing solution…</Text>}
      {message && <Text accessibilityRole="alert">{message}</Text>}
      {execution && (
        <View className="gap-2">
          <Text accessibilityRole="alert">
            {executionMode === "run" ? "Example run" : "Full submission"}:{" "}
            {execution.status ?? (execution.passed === execution.total ? "passed" : "failed")} ·{" "}
            {execution.passed}/{execution.total} passed
            {execution.runtimeMs === undefined ? "" : ` · ${String(execution.runtimeMs)} ms`}
          </Text>
          {[...execution.failures, ...(execution.diagnostics ?? [])].map((diagnostic, index) => (
            <Text key={index}>{diagnostic}</Text>
          ))}
          {execution.stdout && <Text>{execution.stdout}</Text>}
        </View>
      )}
    </View>
  );
}
