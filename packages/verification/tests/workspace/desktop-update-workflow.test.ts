import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  runDesktopUpdate,
  type DesktopUpdatePorts,
  type UpdateStage,
} from "../../../../apps/desktop/src/main/services/update-workflow";

function fixture(
  options: {
    readonly fail?: UpdateStage;
    readonly download?: boolean;
    readonly restart?: boolean;
    readonly available?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const stage = <A>(name: UpdateStage, result: A) =>
    Effect.suspend(() => {
      calls.push(name);
      return options.fail === name
        ? Effect.fail({ _tag: "DesktopUpdateFailure", stage: name } as const)
        : Effect.succeed(result);
    });
  const ports: DesktopUpdatePorts = {
    check: stage("check", options.available === false ? null : "0.2.0"),
    consentDownload: () => stage("prompt", options.download !== false),
    download: stage("download", undefined),
    consentRestart: stage("prompt", options.restart !== false),
    backup: stage("backup", undefined),
    install: stage("install", undefined),
  };
  return { calls, run: () => Effect.runSync(Effect.either(runDesktopUpdate(ports))) };
}
await test("updater obtains download/restart consent and a completed backup before invoking installer", () => {
  const workflow = fixture();
  assert.ok(Either.isRight(workflow.run()));
  assert.deepEqual(workflow.calls, ["check", "prompt", "download", "prompt", "backup", "install"]);
});
await test("failed checks, downloads and recovery backups never invoke the installer", () => {
  for (const fail of ["check", "download", "backup"] as const) {
    const workflow = fixture({ fail });
    assert.ok(Either.isLeft(workflow.run()));
    assert.ok(!workflow.calls.includes("install"));
  }
});
await test("deferring either consent prevents installation and current versions need no prompt", () => {
  for (const options of [{ download: false }, { restart: false }, { available: false }]) {
    const workflow = fixture(options);
    assert.ok(Either.isRight(workflow.run()));
    assert.ok(!workflow.calls.includes("install"));
    assert.ok(!workflow.calls.includes("backup"));
  }
});
