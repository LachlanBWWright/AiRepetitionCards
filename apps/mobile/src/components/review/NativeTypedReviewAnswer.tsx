import type { AnswerDifference } from "@recall/application";
import { Text, TextInput, View } from "react-native";
import { useTypedAnswer } from "@recall/react";
import type { Assessment } from "@recall/domain";

export function NativeTypedReviewAnswer({
  card,
  revealed,
  disabled,
  onReveal,
}: {
  readonly card: Assessment;
  readonly revealed: boolean;
  readonly disabled: boolean;
  readonly onReveal: () => void;
}) {
  const typed = useTypedAnswer(card);
  if (!typed.enabled) return null;
  return (
    <View className="gap-2 my-3">
      {!revealed ? (
        <>
          <Text className="text-recall-ink">Type your answer</Text>
          <TextInput
            accessibilityLabel="Type your answer"
            value={typed.answer}
            editable={!disabled}
            maxLength={20_000}
            autoCorrect={false}
            autoCapitalize="none"
            onChangeText={typed.setAnswer}
            onSubmitEditing={onReveal}
            className="border border-recall-line rounded-lg p-3 text-recall-ink"
          />
        </>
      ) : (
        <View accessibilityLiveRegion="polite" className="gap-2">
          <Text className="text-recall-ink">Your answer: {typed.answer || "(blank)"}</Text>
          <Text className="text-recall-ink">
            {typed.comparison?.matches ? "Answer matches." : "Compare your answer:"}
          </Text>
          <Text>
            {typed.comparison?.differences.map((part, index) => (
              <AnswerPart key={index} part={part} />
            ))}
          </Text>
          <Text className="text-recall-muted">Choose a rating based on your recall.</Text>
        </View>
      )}
    </View>
  );
}

function AnswerPart({ part }: { readonly part: AnswerDifference }) {
  if (part.kind === "extra")
    return (
      <Text style={{ color: "#b91c1c", textDecorationLine: "line-through" }}>{part.text} </Text>
    );
  if (part.kind === "missing")
    return <Text style={{ color: "#15803d", textDecorationLine: "underline" }}>{part.text} </Text>;
  return <Text>{part.text} </Text>;
}
