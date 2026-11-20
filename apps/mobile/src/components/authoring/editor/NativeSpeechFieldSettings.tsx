import { Text, TextInput, View } from "react-native";
import type { SpeechFieldSettings } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";
import { NativeSpeechVoicePicker } from "./NativeSpeechVoicePicker";
export function NativeSpeechFieldSettings({
  side,
  speech,
  update,
  disabled,
}: {
  readonly side: "front" | "back";
  readonly speech: SpeechFieldSettings | undefined;
  readonly update: (value: SpeechFieldSettings | undefined) => void;
  readonly disabled: boolean;
}) {
  return (
    <View className="gap-2">
      <NativeButton
        disabled={disabled}
        variant="default"
        label={`${side === "front" ? "Question" : "Answer"} speech: ${speech ? "on" : "off"}`}
        onPress={() => {
          update(speech ? undefined : { language: "en-US", rate: 1, autoplay: false });
        }}
      />
      {speech && (
        <>
          <Text className="text-recall-ink">Language code</Text>
          <TextInput
            accessibilityLabel={`${side} speech language`}
            editable={!disabled}
            value={speech.language}
            maxLength={80}
            onChangeText={(language) => {
              update({ ...speech, language });
            }}
            className="w-full min-h-12 border border-recall-line rounded-xl px-3 py-3 text-base text-recall-ink"
          />
          <NativeSpeechVoicePicker speech={speech} update={update} disabled={disabled} />
          <Text className="text-recall-ink">Speed (0.25–2)</Text>
          <TextInput
            accessibilityLabel={`${side} speech speed`}
            editable={!disabled}
            value={String(speech.rate)}
            keyboardType="decimal-pad"
            onChangeText={(text) => {
              const rate = Number(text);
              if (rate >= 0.25 && rate <= 2) update({ ...speech, rate });
            }}
            className="w-full min-h-12 border border-recall-line rounded-xl px-3 py-3 text-base text-recall-ink"
          />
          <NativeButton
            disabled={disabled}
            variant="default"
            label={`Automatic speech: ${speech.autoplay ? "on" : "off"}`}
            onPress={() => {
              update({ ...speech, autoplay: !speech.autoplay });
            }}
          />
        </>
      )}
    </View>
  );
}
