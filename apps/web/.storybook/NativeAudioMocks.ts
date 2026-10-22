import { useMemo } from "react";

/** Device recording stays unavailable in browser stories; never request a real microphone. */
export const requestRecordingPermissionsAsync = () =>
  Promise.resolve({ granted: false, status: "denied", canAskAgain: false, expires: "never" });
export const setAudioModeAsync = () => Promise.resolve(undefined);
export const RecordingPresets = { HIGH_QUALITY: {} } as const;
export function useAudioRecorder() {
  return useMemo(
    () => ({
      isRecording: false,
      uri: null,
      prepareToRecordAsync: () => Promise.resolve(undefined),
      record: () => undefined,
      stop: () => Promise.resolve(undefined),
    }),
    [],
  );
}
export function useAudioPlayer() {
  return useMemo(() => ({ play: () => undefined, pause: () => undefined }), []);
}
