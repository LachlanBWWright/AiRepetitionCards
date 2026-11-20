import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTests } from "./build-tests.mjs";

await test("test bundles share dependencies and omit embedded source copies", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "recall-build-regression-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "tests"));
  // Large enough that a dependency copied into both entry points fails the size check.
  const payload = "shared-dependency-marker-".repeat(12_000);
  await writeFile(
    path.join(root, "shared.ts"),
    `export const payload = ${JSON.stringify(payload)};`,
  );
  const files = ["first.test.ts", "second.test.ts"];
  for (const file of files) {
    await writeFile(
      path.join(root, "tests", file),
      `import assert from "node:assert/strict";
       import test from "node:test";
       import { payload } from "../shared";
       test("${file}", () => assert.equal(payload.length, ${String(payload.length)}));`,
    );
  }
  const output = path.join(root, "output");
  await buildTests(root, "tests", files, output);
  const emitted = await readdir(output);
  const modules = await Promise.all(
    emitted
      .filter((file) => file.endsWith(".mjs"))
      .map((file) => readFile(path.join(output, file), "utf8")),
  );
  assert.ok(modules.reduce((total, source) => total + source.length, 0) < payload.length * 1.5);
  assert.equal(modules.filter((source) => source.includes(payload)).length, 1);
  for (const source of modules) assert.doesNotMatch(source, /sourceMappingURL=data:/);
  for (const file of emitted.filter((file) => file.endsWith(".map"))) {
    const map = JSON.parse(await readFile(path.join(output, file), "utf8"));
    assert.equal(map.sourcesContent, undefined);
  }
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-concurrency=2",
      ...files.map((file) => path.join(output, file.replace(/\.ts$/, ".mjs"))),
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
