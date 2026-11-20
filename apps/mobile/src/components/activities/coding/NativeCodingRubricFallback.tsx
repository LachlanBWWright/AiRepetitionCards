import { Text, View } from "react-native";
import type { useLearningActivities } from "@recall/react";
import { NativeButton } from "../../ui/NativeButton";

export function NativeCodingRubricFallback({
  model,
  disabled,
}: {
  readonly model: ReturnType<typeof useLearningActivities>;
  readonly disabled: boolean;
}) {
  if ((model.coding.available && !model.coding.message) || model.result) return null;
  return (
    <View className="gap-2">
      <Text>
        Execution is unavailable. Your code is retained. Save progress or explicitly assess your
        solution against the rubric.
      </Text>
      {[
        { score: 0, label: "Needs work" },
        { score: 0.5, label: "Partially meets rubric" },
        { score: 1, label: "Meets rubric" },
      ].map(({ score, label }) => (
        <NativeButton
          key={score}
          label={label}
          variant="default"
          selected={model.response.selfScore === score}
          disabled={disabled}
          onPress={() => {
            model.setResponse((current) => ({ ...current, selfScore: score }));
          }}
        />
      ))}
      <NativeButton
        label="Propose self-assessment"
        disabled={disabled || !model.response.answers[0]?.trim()}
        onPress={model.assess}
      />
    </View>
  );
}
