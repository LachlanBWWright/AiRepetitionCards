import { build } from "esbuild";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function runSuite(directory, requested) {
  const available = (await readdir(path.join(root, directory)))
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
  const files = available.filter((name) => requested.length === 0 || requested.includes(name));
  if (files.length === 0 || requested.some((name) => !available.includes(name))) {
    process.stderr.write("No regression checks found.\n");
    process.exitCode = 1;
  } else {
    const output = await mkdtemp(path.join(tmpdir(), "recall-verification-"));
    try {
      await build({
        absWorkingDir: root,
        entryPoints: files.map((name) => path.join(directory, name)),
        outdir: output,
        bundle: true,
        platform: "node",
        conditions: ["react-server"],
        target: "node22",
        format: "esm",
        outExtension: { ".js": ".mjs" },
        sourcemap: "inline",
        banner: {
          js: 'import { createRequire as recallCreateRequire } from "node:module"; const require = recallCreateRequire(import.meta.url);',
        },
        logLevel: "warning",
      });
      const result = await new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          ["--test", ...files.map((name) => path.join(output, name.replace(/\.ts$/, ".mjs")))],
          {
            stdio: "inherit",
            cwd: root,
            env: { ...process.env, TZ: "UTC" },
          },
        );
        child.once("error", () => resolve(1));
        child.once("exit", (code) => resolve(code ?? 1));
      });
      process.exitCode = result;
    } catch {
      process.stderr.write("Regression runner could not compile or execute its checks.\n");
      process.exitCode = 1;
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  }
}
