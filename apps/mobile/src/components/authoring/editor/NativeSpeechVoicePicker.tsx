import type { SpeechFieldSettings } from "@recall/domain";
import { useSpeechVoices } from "@recall/react";
import { NativeSelect } from "@recall/ui-native";
import { NativeButton } from "../../ui/NativeButton";
import { nativeSpeech } from "../../../storage/media/native-speech";
import { Text, View } from "react-native";
export function NativeSpeechVoicePicker({
  speech,
  update,
  disabled,
}: {
  readonly speech: SpeechFieldSettings;
  readonly update: (value: SpeechFieldSettings) => void;
  readonly disabled: boolean;
}) {
  const voices = useSpeechVoices(nativeSpeech);
  return (
    <View className="gap-2">
      <NativeButton
        label="Load device voices"
        tone="soft"
        disabled={disabled}
        onPress={() => {
          void voices.refresh();
        }}
      />
      <NativeSelect
        label="Voice"
        value={speech.voice ?? "default"}
        disabled={disabled}
        options={[
          { label: "Default voice", value: "default" },
          ...voices.voices.map((voice) => ({
            value: voice.id,
            label: `${voice.name} (${voice.language})`,
          })),
        ]}
        onValueChange={(voice) => {
          update({ ...speech, voice: voice === "default" ? undefined : voice });
        }}
      />
      {voices.error && <Text>{voices.error}</Text>}
    </View>
  );
}
