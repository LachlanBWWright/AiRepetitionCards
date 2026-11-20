import { useState } from "react";

/** Screen stories never request a microphone or create device recordings. */
export const RecordingPresets = { HIGH_QUALITY: {} } as const;
export const requestRecordingPermissionsAsync = () => Promise.resolve({ granted: false });
export const setAudioModeAsync = () => Promise.resolve();

export function useAudioRecorder() {
  const [recorder] = useState(() => ({
    isRecording: false,
    uri: null,
    prepareToRecordAsync: () => Promise.resolve(),
    record: () => undefined,
    stop: () => Promise.resolve(),
  }));
  return recorder;
}
