import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const directory of ["apps", "packages"]) {
  for (const entry of await readdir(`${root}${directory}`, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = `${root}${directory}/${entry.name}/tsconfig.json`;
    if (!ts.sys.fileExists(path)) continue;
    const config = ts.getParsedCommandLineOfConfigFile(
      path,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => assert.fail(diagnostic.messageText),
      },
    );
    assert.ok(config, path);
    for (const option of [
      "strict",
      "noUncheckedIndexedAccess",
      "exactOptionalPropertyTypes",
      "noImplicitOverride",
      "noFallthroughCasesInSwitch",
      "noImplicitReturns",
      "useUnknownInCatchVariables",
    ]) {
      assert.equal(config.options[option], true, `${path}: ${option}`);
    }
    for (const option of [
      "noImplicitAny",
      "noImplicitThis",
      "strictNullChecks",
      "strictFunctionTypes",
      "strictBindCallApply",
      "strictPropertyInitialization",
      "strictBuiltinIteratorReturn",
      "alwaysStrict",
    ]) {
      assert.notEqual(config.options[option], false, `${path}: ${option} must inherit strict`);
    }
  }
}
const configurations = [
  {
    cwd: root,
    overrideConfigFile: `${root}packages/eslint.config.mjs`,
    files: [
      "packages/domain/src/index.ts",
      "packages/verification/tests/review/clock-sync.test.ts",
    ],
  },
  {
    cwd: `${root}apps/web`,
    files: ["src/proxy.ts", "pwa/image.tsx", "next.config.ts", ".storybook/main.ts"],
  },
  {
    cwd: `${root}apps/desktop`,
    files: ["src/main/index.ts", "electron.vite.config.ts"],
  },
  {
    cwd: `${root}apps/mobile`,
    files: ["App.tsx", "app.config.ts", "src/storage/native-chatgpt-auth.ts"],
  },
];

for (const { files, ...options } of configurations) {
  const eslint = new ESLint(options);
  for (const file of files) {
    const config = await eslint.calculateConfigForFile(file);
    assert.ok(config, `${file} must have an ESLint config`);
    assert.equal(config.languageOptions.parserOptions.projectService, true, file);
    assert.equal(config.linterOptions.noInlineConfig, true, file);
    for (const rule of [
      "@typescript-eslint/no-explicit-any",
      "@typescript-eslint/no-unsafe-assignment",
      "@typescript-eslint/no-floating-promises",
      "@typescript-eslint/ban-ts-comment",
      "neverthrow/must-use-result",
    ]) {
      assert.equal(config.rules[rule][0], 2, `${file}: ${rule} must be an error`);
    }
  }
}

// Use a structural Result fixture to exercise the upstream plugin without adding
// a second application error-handling dependency alongside Effect.
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: `${root}packages/eslint.config.mjs`,
});
const fixture = `
interface ResultFixture {
  mapErr(): ResultFixture;
  map(): ResultFixture;
  andThen(): ResultFixture;
  orElse(): ResultFixture;
  match(): number;
  unwrapOr(): number;
}
declare function result(): ResultFixture;
result();
Promise.resolve(1);
export type Unsafe = any;
`;
const [invalid] = await eslint.lintText(fixture, { filePath: "packages/domain/src/index.ts" });
for (const rule of [
  "neverthrow/must-use-result",
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-explicit-any",
]) {
  assert.ok(
    invalid.messages.some((message) => message.ruleId === rule),
    rule,
  );
}
const [valid] = await eslint.lintText(fixture.replace("result();", "result().match();"), {
  filePath: "packages/domain/src/index.ts",
});
assert.ok(!valid.messages.some((message) => message.ruleId === "neverthrow/must-use-result"));
process.stdout.write("Strict TypeScript ESLint coverage and neverthrow enforcement passed.\n");
