import { useCallback, useEffect, useState } from "react";
import { Effect, Either } from "effect";
import { reviewPlainText, type SpeechPort } from "@recall/application";
import type { Assessment } from "@recall/domain";

export function useCardSpeech(card: Assessment, revealed: boolean, port: SpeechPort) {
  const [error, setError] = useState<string | null>(null);
  const settings = revealed ? card.presentation?.speech?.back : card.presentation?.speech?.front;
  const text = reviewPlainText(revealed ? card.back : card.front);
  const speak = useCallback(async () => {
    if (!settings) return;
    setError(null);
    const result = await Effect.runPromise(Effect.either(port.speak(text, settings)));
    if (Either.isLeft(result)) setError(result.left.message);
  }, [port, text, settings]);
  useEffect(() => {
    if (settings?.autoplay) Effect.runFork(port.speak(text, settings).pipe(Effect.ignore));
    return () => {
      Effect.runFork(port.stop.pipe(Effect.ignore));
    };
  }, [card.id, port, text, settings]);
  return { enabled: settings !== undefined, speak, error };
}
