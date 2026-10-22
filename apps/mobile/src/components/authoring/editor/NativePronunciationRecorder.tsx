import { Text, View } from "react-native";
import { Effect, Either } from "effect";
import { useEffect, useRef, useState } from "react";
import type { StoredMediaAsset } from "@recall/local-store";
import { NativeButton } from "../../ui/NativeButton";
import { NativeAudioAttachment } from "../../media/NativeAudioAttachment";
import { useNativeRecording } from "./useNativeRecording";
export function NativePronunciationRecorder({
  onAttach,
  disabled,
}: {
  readonly onAttach: (asset: StoredMediaAsset) => void;
  readonly disabled: boolean;
}) {
  const recording = useNativeRecording();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  async function attach() {
    setAttaching(true);
    const result = await Effect.runPromise(Effect.either(recording.read()));
    if (!mounted.current) return;
    if (Either.isLeft(result)) setError(result.left.message);
    else {
      onAttach(result.right);
      recording.discard();
      setError(null);
    }
    setAttaching(false);
  }
  return (
    <View className="gap-2">
      <NativeButton
        tone="soft"
        disabled={disabled || recording.busy || attaching}
        label={recording.recording ? "Stop recording" : "Record pronunciation"}
        onPress={() => {
          void recording.toggle();
        }}
      />
      {recording.uri && (
        <>
          <NativeAudioAttachment uri={recording.uri} />
          <NativeButton
            tone="soft"
            disabled={disabled || attaching}
            label="Use recording as attachment"
            onPress={() => {
              void attach();
            }}
          />
          <NativeButton
            tone="soft"
            disabled={attaching}
            label="Discard recording"
            onPress={recording.discard}
          />
        </>
      )}
      {(error || recording.error) && (
        <Text accessibilityLiveRegion="polite">{error || recording.error}</Text>
      )}
      <Text className="text-recall-muted text-xs">Preview, attach, then save the card.</Text>
    </View>
  );
}
