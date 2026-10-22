import { useCallback, useState } from "react";
import { Effect, Either } from "effect";
import type { SpeechPort, SpeechVoice } from "@recall/application";
export function useSpeechVoices(port: SpeechPort) {
  const [voices, setVoices] = useState<readonly SpeechVoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const result = await Effect.runPromise(Effect.either(port.voices));
    if (Either.isLeft(result)) setError(result.left.message);
    else {
      setVoices(result.right);
      setError(null);
    }
  }, [port]);
  return { voices, refresh, error };
}
