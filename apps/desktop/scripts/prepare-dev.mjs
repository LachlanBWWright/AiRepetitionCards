import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { prepareOcrAssets } from "../../web/scripts/prepare-ocr-assets.mjs";

const require = createRequire(import.meta.url);

// Electron's package can be present without its separate executable download.
// Its installer verifies the installed version and reuses cached downloads.
if (!process.env.ELECTRON_EXEC_PATH) {
  const result = spawnSync(process.execPath, [require.resolve("electron/install.js")], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(
      "Electron setup failed. Check network access, then retry pnpm dev:desktop.\n",
    );
    process.exit(result.status ?? 1);
  }
}

await prepareOcrAssets("desktop");
