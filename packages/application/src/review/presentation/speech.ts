import { Effect } from "effect";
import type { SpeechFieldSettings } from "@recall/domain";
export type SpeechFailure = {
  readonly _tag: "SpeechFailure";
  readonly message: string;
};
export type SpeechVoice = { readonly id: string; readonly name: string; readonly language: string };
export type SpeechPort = {
  readonly voices: Effect.Effect<readonly SpeechVoice[], SpeechFailure>;
  readonly speak: (
    text: string,
    settings: SpeechFieldSettings,
  ) => Effect.Effect<void, SpeechFailure>;
  readonly stop: Effect.Effect<void, SpeechFailure>;
};
