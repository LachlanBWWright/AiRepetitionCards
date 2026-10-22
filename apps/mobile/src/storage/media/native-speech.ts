import { Effect, Either } from "effect";
import * as Speech from "expo-speech";
import type { SpeechPort, SpeechFailure } from "@recall/application";
import type { SpeechFieldSettings } from "@recall/domain";
const failure = (): SpeechFailure => ({
  _tag: "SpeechFailure",
  message: "Speech is unavailable. Check this device's language voices.",
});
function startSpeech(
  text: string,
  settings: SpeechFieldSettings,
  resume: (effect: Effect.Effect<undefined, SpeechFailure>) => void,
) {
  Speech.speak(text, {
    language: settings.language,
    ...(settings.voice ? { voice: settings.voice } : {}),
    rate: settings.rate,
    onDone: () => {
      resume(Effect.succeed(undefined));
    },
    onStopped: () => {
      resume(Effect.succeed(undefined));
    },
    onError: () => {
      resume(Effect.fail(failure()));
    },
  });
}
export const nativeSpeech: SpeechPort = {
  voices: Effect.tryPromise({
    try: async () =>
      (await Speech.getAvailableVoicesAsync()).map((voice) => ({
        id: voice.identifier,
        name: voice.name,
        language: voice.language,
      })),
    catch: failure,
  }),
  stop: Effect.tryPromise({ try: () => Speech.stop(), catch: failure }),
  speak: (text, settings) =>
    Effect.async<undefined, SpeechFailure>((resume) => {
      const started = Effect.runSync(
        Effect.either(
          Effect.try({
            try: () => {
              startSpeech(text, settings, resume);
            },
            catch: failure,
          }),
        ),
      );
      if (Either.isLeft(started)) resume(Effect.fail(started.left));
      return nativeSpeech.stop.pipe(Effect.ignore);
    }),
};
