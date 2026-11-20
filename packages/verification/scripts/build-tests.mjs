import { build, stop } from "esbuild";
import path from "node:path";

/** Share dependency code instead of copying it, and its sources, into every test. */
export async function buildTests(root, directory, files, output) {
  try {
    await build({
      absWorkingDir: root,
      entryPoints: files.map((name) => path.join(directory, name)),
      outdir: output,
      outbase: path.join(root, directory),
      bundle: true,
      splitting: true,
      platform: "node",
      conditions: ["react-server"],
      target: "node22",
      format: "esm",
      outExtension: { ".js": ".mjs" },
      sourcemap: "linked",
      sourcesContent: false,
      banner: {
        js: 'import { createRequire as recallCreateRequire } from "node:module"; const require = recallCreateRequire(import.meta.url);',
      },
      logLevel: "warning",
    });
  } finally {
    // The compiler must not retain its heap while test workers start up.
    await stop();
  }
}
