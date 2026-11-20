import { buildTests } from "./build-tests.mjs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const batchSize = 4;
async function discoverTests(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry) => {
      const name = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) return discoverTests(path.join(directory, entry.name), name);
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [name] : [];
    }),
  );
  return groups.flat().sort();
}

export async function runSuite(directory, requested) {
  const available = await discoverTests(path.join(root, directory));
  const selections = requested.map((name) =>
    available.filter(
      (file) => file === name || (!name.includes("/") && path.basename(file) === name),
    ),
  );
  const files = requested.length === 0 ? available : [...new Set(selections.flat())];
  if (files.length === 0 || selections.some((matches) => matches.length !== 1)) {
    process.stderr.write("No regression checks found.\n");
    process.exitCode = 1;
  } else {
    const output = await mkdtemp(path.join(tmpdir(), "recall-verification-"));
    try {
      process.exitCode = 0;
      for (let offset = 0; offset < files.length; offset += batchSize) {
        const batch = files.slice(offset, offset + batchSize);
        process.stdout.write(
          `Verification batch ${String(offset / batchSize + 1)}/${String(Math.ceil(files.length / batchSize))}\n`,
        );
        await buildTests(root, directory, batch, output);
        const result = await new Promise((resolve) => {
          const child = spawn(
            process.execPath,
            [
              "--test",
              "--test-concurrency=1",
              "--enable-source-maps",
              ...batch.map((name) => path.join(output, name.replace(/\.ts$/, ".mjs"))),
            ],
            {
              stdio: "inherit",
              cwd: root,
              env: { ...process.env, TZ: "UTC" },
            },
          );
          child.once("error", () => resolve(1));
          child.once("exit", (code) => resolve(code ?? 1));
        });
        if (result !== 0) process.exitCode = result;
        await rm(output, { recursive: true, force: true });
      }
    } catch {
      process.stderr.write("Regression runner could not compile or execute its checks.\n");
      process.exitCode = 1;
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  }
}
