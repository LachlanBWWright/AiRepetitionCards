import type { Assessment } from "@recall/domain";
import { useCardSpeech } from "@recall/react";
import { Text, View } from "react-native";
import { NativeButton } from "../ui/NativeButton";
import { nativeSpeech } from "../../storage/media/native-speech";
export function NativeReviewSpeech({
  card,
  revealed,
}: {
  readonly card: Assessment;
  readonly revealed: boolean;
}) {
  const speech = useCardSpeech(card, revealed, nativeSpeech);
  if (!speech.enabled) return null;
  return (
    <View className="my-2">
      <NativeButton
        label="Read aloud"
        tone="soft"
        onPress={() => {
          void speech.speak();
        }}
      />
      {speech.error && <Text accessibilityLiveRegion="polite">{speech.error}</Text>}
    </View>
  );
}
