import { useEffect, useState } from "react";
import { Effect, Either } from "effect";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { readNativeRecording } from "../../../storage/media/native-recording";
export function useNativeRecording() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  useEffect(
    () => () => {
      Effect.runFork(
        Effect.tryPromise({
          try: async () => {
            if (recorder.isRecording) await recorder.stop();
            await setAudioModeAsync({ allowsRecording: false });
          },
          catch: () => ({ message: "Could not finish recorder cleanup." }),
        }).pipe(Effect.ignore),
      );
    },
    [recorder],
  );
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    const operation = recording
      ? Effect.tryPromise({
          try: async () => {
            await recorder.stop();
            await setAudioModeAsync({ allowsRecording: false });
            return recorder.uri;
          },
          catch: () => ({ message: "Could not finish recording." }),
        })
      : Effect.gen(function* () {
          const permission = yield* Effect.tryPromise({
            try: requestRecordingPermissionsAsync,
            catch: () => ({ message: "Microphone permission is unavailable." }),
          });
          if (!permission.granted)
            return yield* Effect.fail({
              message: "Allow microphone access to record pronunciation.",
            });
          yield* Effect.tryPromise({
            try: async () => {
              await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
              await recorder.prepareToRecordAsync();
              recorder.record();
            },
            catch: () => ({ message: "Could not start recording." }),
          });
          return null;
        });
    const result = await Effect.runPromise(Effect.either(operation));
    if (Either.isLeft(result)) setError(result.left.message);
    else {
      setUri(result.right);
      setRecording(!recording);
    }
    setBusy(false);
  }
  const read = () =>
    uri
      ? readNativeRecording(uri)
      : Effect.fail({ _tag: "RecordingFailure" as const, message: "Record audio first." });
  return {
    recording,
    busy,
    uri,
    error,
    toggle,
    read,
    discard: () => {
      setUri(null);
    },
  };
}
