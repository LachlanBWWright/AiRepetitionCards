import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../packages/design-tokens/", import.meta.url);
const source = JSON.parse(await readFile(new URL("tokens.json", root), "utf8"));
const groups = ["color", "radius", "spacing"];
const valid =
  typeof source === "object" &&
  source !== null &&
  groups.every(
    (group) =>
      typeof source[group] === "object" &&
      source[group] !== null &&
      Object.entries(source[group]).every(
        ([name, value]) =>
          /^[a-z][a-zA-Z0-9]*$/.test(name) &&
          (group === "color"
            ? typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value)
            : typeof value === "number" && Number.isFinite(value) && value >= 0),
      ),
  );
if (!valid) {
  process.stderr.write("Invalid canonical design tokens.\n");
  process.exitCode = 1;
} else {
  const toCssName = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const declarations = groups.flatMap((group) =>
    Object.entries(source[group]).map(
      ([name, value]) =>
        `  --recall-${group === "color" ? "" : `${group}-`}${toCssName(name)}: ${value}${group === "color" ? "" : "px"};`,
    ),
  );
  const files = [
    [
      "src/index.ts",
      `// Generated from tokens.json with pnpm tokens:write.\nexport const designTokens = ${JSON.stringify(source, null, 2)} as const;\n`,
    ],
    [
      "src/tokens.css",
      `/* Generated from tokens.json with pnpm tokens:write. */\n:root {\n${declarations.join("\n")}\n}\n`,
    ],
  ];
  for (const [path, content] of files) {
    const target = new URL(path, root);
    if (process.argv.includes("--check")) {
      const current = await readFile(target, "utf8");
      // Prettier removes unnecessary quotes from TypeScript property keys.
      const normalized = (value) =>
        value.replace(/"([a-zA-Z][a-zA-Z0-9]*)":/g, "$1:").replace(/,(\s*[}\]])/g, "$1");
      if (normalized(current) !== normalized(content)) {
        process.stderr.write(
          `Generated design tokens are stale: ${path}. Run pnpm tokens:write.\n`,
        );
        process.exitCode = 1;
      }
    } else {
      await writeFile(target, content);
    }
  }
  if (!process.exitCode) process.stdout.write("Design tokens are synchronized.\n");
}
