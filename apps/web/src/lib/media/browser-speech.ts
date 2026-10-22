import { Effect, Either } from "effect";
import type { SpeechPort, SpeechFailure } from "@recall/application";
import type { SpeechFieldSettings } from "@recall/domain";
const failure = (message: string): SpeechFailure => ({ _tag: "SpeechFailure", message });
function startSpeech(
  text: string,
  settings: SpeechFieldSettings,
  resume: (effect: Effect.Effect<undefined, SpeechFailure>) => void,
) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    resume(Effect.fail(failure("Speech synthesis is unavailable on this device.")));
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = settings.language;
  utterance.rate = settings.rate;
  utterance.voice =
    window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === settings.voice) ?? null;
  utterance.onend = () => {
    resume(Effect.succeed(undefined));
  };
  utterance.onerror = (event) => {
    const canceled = event.error === "canceled" || event.error === "interrupted";
    resume(
      canceled
        ? Effect.succeed(undefined)
        : Effect.fail(failure("Could not play speech. Try a different language or voice.")),
    );
  };
  window.speechSynthesis.speak(utterance);
}
export const browserSpeech: SpeechPort = {
  voices: Effect.try({
    try: () =>
      window.speechSynthesis.getVoices().map((voice) => ({
        id: voice.voiceURI,
        name: voice.name,
        language: voice.lang,
      })),
    catch: () => failure("Speech synthesis is unavailable on this device."),
  }),
  stop: Effect.try({
    try: () => {
      window.speechSynthesis.cancel();
    },
    catch: () => failure("Could not stop speech."),
  }),
  speak: (text, settings) =>
    Effect.async<undefined, SpeechFailure>((resume) => {
      const started = Effect.runSync(
        Effect.either(
          Effect.try({
            try: () => {
              startSpeech(text, settings, resume);
            },
            catch: () => failure("Could not play speech. Try a different language or voice."),
          }),
        ),
      );
      if (Either.isLeft(started)) resume(Effect.fail(started.left));
      return browserSpeech.stop.pipe(Effect.ignore);
    }),
};
