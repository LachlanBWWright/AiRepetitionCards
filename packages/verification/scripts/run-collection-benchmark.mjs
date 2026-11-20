import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildTests } from "./build-tests.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "recall-collection-benchmark-"));
try {
  await buildTests(root, "scripts", ["benchmark-collection.ts"], directory);
  const output = join(directory, "benchmark-collection.mjs");
  process.argv = [process.execPath, output, ...process.argv.slice(2)];
  await import(pathToFileURL(output).href);
} finally {
  await rm(directory, { recursive: true, force: true });
}
