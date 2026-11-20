import { Effect } from "effect";

export type UpdateStage = "check" | "prompt" | "download" | "backup" | "install";
export interface DesktopUpdateFailure {
  readonly _tag: "DesktopUpdateFailure";
  readonly stage: UpdateStage;
}
export interface DesktopUpdatePorts {
  readonly check: Effect.Effect<string | null, DesktopUpdateFailure>;
  readonly consentDownload: (version: string) => Effect.Effect<boolean, DesktopUpdateFailure>;
  readonly download: Effect.Effect<void, DesktopUpdateFailure>;
  readonly consentRestart: Effect.Effect<boolean, DesktopUpdateFailure>;
  readonly backup: Effect.Effect<void, DesktopUpdateFailure>;
  readonly install: Effect.Effect<void, DesktopUpdateFailure>;
}

/** No installation runs before both explicit restart consent and a completed recovery backup. */
export function runDesktopUpdate(
  ports: DesktopUpdatePorts,
): Effect.Effect<boolean, DesktopUpdateFailure> {
  return Effect.gen(function* () {
    const version = yield* ports.check;
    if (version === null || !(yield* ports.consentDownload(version))) return false;
    yield* ports.download;
    if (!(yield* ports.consentRestart)) return false;
    yield* ports.backup;
    yield* ports.install;
    return true;
  });
}
