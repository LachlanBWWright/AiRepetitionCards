import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { formatReport, inspectSource, isAuthoredSource } from "./check-source-limits.mjs";

test("400 lines pass; 401 fail; a final newline is not another line", () => {
  assert.equal(inspectSource("example.ts", "line\n".repeat(400)).tooLong, false);
  assert.equal(inspectSource("example.ts", "line\n".repeat(401)).tooLong, true);
  assert.equal(inspectSource("example.ts", "").lineCount, 0);
  assert.equal(inspectSource("example.ts", "line\r\nline\r\n").lineCount, 2);
});

test("eight indentation levels pass; nine fail using each language's indentation width", () => {
  for (const [file, width] of [
    ["example.ts", 2],
    ["example.cs", 4],
    ["example.py", 4],
  ]) {
    assert.equal(inspectSource(file, `${" ".repeat(width * 8)}value`).deepest, null);
    assert.deepEqual(inspectSource(file, `${" ".repeat(width * 9)}value`).deepest, {
      line: 1,
      level: 9,
    });
  }
});

test("tabs advance to indentation stops; blank lines are ignored; deepest location is reported", () => {
  const result = inspectSource(
    "example.ts",
    `${"\t".repeat(8)}value\n ${"\t".repeat(9)}value\n${" ".repeat(20)}\n${" ".repeat(20)}value`,
  );
  assert.deepEqual(result.deepest, { line: 4, level: 10 });
  assert.equal(result.indentedLines, 2);
});

test("authored source across languages is checked while generated, vendor, and data files are excluded", () => {
  for (const file of [
    "apps/web/.storybook/main.ts",
    "apps/mobile/index.js",
    "scripts/check.mjs",
    "backend/Program.cs",
    "supabase/migrations/initial.sql",
    "backend/scripts/check.py",
    "apps/mobile/modules/recall-ocr/ios/Module.swift",
    "native/Module.kt",
    "native/build.gradle",
    "native/Module.podspec",
    "scripts/check.sh",
    "src/style.css",
    "native/layout.xml",
  ])
    assert.equal(isAuthoredSource(file), true, file);
  for (const file of [
    "node_modules/example/index.ts",
    "apps/web/.next/types/routes.ts",
    "src/vendor/index.js",
    "packages/infra-supabase/src/database.types.ts",
    "packages/design-tokens/src/index.ts",
    "packages/design-tokens/src/tokens.css",
    "apps/web/next-env.d.ts",
    "apps/mobile/android/Generated.kt",
    "apps/mobile/ios/Generated.swift",
    "apps/mobile/modules/recall-ocr/android/build/Generated.kt",
    "backend/obj/Program.g.cs",
    "src/Program.generated.cs",
    "README.md",
    "package.json",
    "pnpm-lock.yaml",
  ])
    assert.equal(isAuthoredSource(file), false, file);
});

test("CLI exits successfully for compliant files and fails with a source location for violations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recall-source-limits-"));
  const file = join(directory, "fixture.ts");
  const execute = promisify(execFile);
  const script = new URL("./check-source-limits.mjs", import.meta.url);
  try {
    await writeFile(file, `${" ".repeat(16)}value;\n`);
    const passed = await execute(process.execPath, [fileURLToPath(script), file]);
    assert.match(passed.stdout, /1 files checked; 0 over 400 lines; 0 exceed 8/);
    await writeFile(file, `${" ".repeat(18)}value;\n`);
    await assert.rejects(execute(process.execPath, [fileURLToPath(script), file]), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /fixture\.ts:1:1: indentation level 9/);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("report separates violations and sorts each section descending with stable filename ties", () => {
  const results = [
    inspectSource("b.ts", "                  value\n".repeat(500)),
    inspectSource("z.ts", "                    value\n".repeat(401)),
    inspectSource("a.ts", "                  value\n".repeat(500)),
    inspectSource("clean.ts", "value\n"),
  ];
  const original = [...results];
  const report = formatReport(results);
  const [indentation, size] = report.text.split("\n\n");
  assert.equal(report.failed, true);
  assert.deepEqual(results, original);
  assert.match(indentation, /^Indentation .*maximum 8/);
  assert.deepEqual(
    indentation
      .split("\n")
      .slice(1)
      .map((line) => line.split(":")[0]),
    ["z.ts", "a.ts", "b.ts"],
  );
  assert.match(size, /^Line count .*maximum 400/);
  assert.deepEqual(
    size
      .split("\n")
      .slice(1)
      .map((line) => line.split(":")[0]),
    ["a.ts", "b.ts", "z.ts"],
  );
  assert.match(report.text, /4 files checked; 3 over 400 lines; 3 exceed 8/);
});

test("empty sections explicitly report no violations", () => {
  const report = formatReport([inspectSource("clean.ts", "value\n")]);
  assert.equal(report.failed, false);
  assert.match(report.text, /No indentation violations/);
  assert.match(report.text, /No line-count violations/);
});
