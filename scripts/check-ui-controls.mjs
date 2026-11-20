import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { controlViolations, controlInventory } from "./ui-control-policy.mjs";

const files = execFileSync("rg", ["--files", "apps", "packages"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((path) => path.endsWith(".tsx") && !/(storybook-static|\/dist\/|\.stories\.)/.test(path));
const primitives = new Set([
  "packages/ui-web/src/components/button.tsx",
  "packages/ui-web/src/components/collapsible.tsx",
  "packages/ui-web/src/components/accordion.tsx",
  "packages/ui-native/src/NativeButton.tsx",
  "packages/ui-web/src/components/sidebar.tsx",
]);
const inventory = {};
for (const path of files) {
  for (const [variant, count] of Object.entries(controlInventory(readFileSync(path, "utf8"), path)))
    inventory[variant] = (inventory[variant] ?? 0) + count;
}
process.stdout.write(`Button purposes: ${JSON.stringify(inventory)}\n`);
const violations = files
  .filter((path) => !primitives.has(path))
  .flatMap((path) => controlViolations(readFileSync(path, "utf8"), path));
if (violations.length) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `UI controls: ${files.length} source files checked; no local button appearance or unstyled disclosure overrides.\n`,
  );
}
