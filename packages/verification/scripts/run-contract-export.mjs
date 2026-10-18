import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "recall-contract-export-"));
try {
  const output = join(directory, "export.mjs");
  await build({
    entryPoints: [resolve(root, "packages/verification/scripts/export-contracts.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  process.argv = [process.execPath, output, root, ...process.argv.slice(2)];
  await import(pathToFileURL(output).href);
} finally {
  await rm(directory, { recursive: true, force: true });
}
