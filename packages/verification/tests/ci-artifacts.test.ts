import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Effect, Either, Schema } from "effect";

const script = path.resolve(process.cwd(), "../../scripts/write-desktop-checksums.mjs");
const Manifest = Schema.Struct({
  algorithm: Schema.Literal("SHA-256"),
  artifacts: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      bytes: Schema.Number.pipe(Schema.int(), Schema.positive()),
      sha256: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
    }),
  ),
});
const fixtures = [
  { platform: "linux", arch: "x64", files: ["Recall-0.1.0-linux-x86_64.AppImage"], valid: true },
  { platform: "linux", arch: "x64", files: ["Recall-0.1.0-linux-x64.AppImage"], valid: true },
  { platform: "windows", arch: "x64", files: ["Recall-0.1.0-win-x64.exe"], valid: true },
  {
    platform: "mac",
    arch: "arm64",
    files: ["Recall-0.1.0-mac-arm64.dmg", "Recall-0.1.0-mac-arm64.zip"],
    valid: true,
  },
  {
    platform: "mac",
    arch: "x64",
    files: ["Recall-0.1.0-mac-x64.dmg", "Recall-0.1.0-mac-x64.zip"],
    valid: true,
  },
  { platform: "mac", arch: "arm64", files: ["Recall-0.1.0-mac-arm64.dmg"], valid: false },
  { platform: "windows", arch: "x64", files: ["Recall-0.1.0-win-arm64.exe"], valid: false },
  { platform: "linux", arch: "x64", files: ["checksums.json"], valid: false },
  {
    platform: "unsupported",
    arch: "x64",
    files: ["Recall-0.1.0-linux-x64.AppImage"],
    valid: false,
  },
] as const;
for (const fixture of fixtures) {
  await test(`desktop artifact gate: ${fixture.platform}/${fixture.arch}, ${fixture.files.join(", ")}`, async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "recall-ci-artifacts-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const release = path.join(directory, "apps/desktop/release");
    await mkdir(release, { recursive: true });
    for (const file of fixture.files)
      await writeFile(path.join(release, file), "fixture installer bytes");
    const result = spawnSync(
      process.execPath,
      [script, `--platform=${fixture.platform}`, `--arch=${fixture.arch}`],
      { cwd: directory, encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, fixture.valid ? 0 : 1, result.stderr);
    if (fixture.valid) {
      const decoded: unknown = JSON.parse(
        await readFile(path.join(release, "checksums.json"), "utf8"),
      );
      const manifest = Effect.runSync(Effect.either(Schema.decodeUnknown(Manifest)(decoded)));
      assert.ok(Either.isRight(manifest));
      assert.equal(manifest.right.artifacts.length, fixture.files.length);
    }
  });
}
await test("desktop artifact gate rejects empty installers", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "recall-ci-empty-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const release = path.join(directory, "apps/desktop/release");
  await mkdir(release, { recursive: true });
  await writeFile(path.join(release, "Recall-0.1.0-linux-x64.AppImage"), "");
  const result = spawnSync(process.execPath, [script, "--platform=linux", "--arch=x64"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Empty desktop installer/);
});
