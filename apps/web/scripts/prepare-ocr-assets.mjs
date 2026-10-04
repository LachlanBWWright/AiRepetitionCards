import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const webDirectory = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(resolve(webDirectory, "package.json"));

// Pin the worker, WASM variants and English model to installed packages. OCR must
// never silently download code or study data through a vendor CDN at runtime.
export async function prepareOcrAssets(platform = "web") {
  const destination =
    platform === "desktop"
      ? resolve(webDirectory, "../desktop/public/vendor/ocr")
      : resolve(webDirectory, "public/vendor/ocr");
  const coreDirectory = dirname(require.resolve("tesseract.js-core/package.json"));
  const languageDirectory = dirname(require.resolve("@tesseract.js-data/eng/package.json"));
  const worker = require.resolve("tesseract.js/dist/worker.min.js");
  const workerDirectory = dirname(require.resolve("tesseract.js/package.json"));
  const assets = [
    [worker, "worker.min.js"],
    [resolve(workerDirectory, "LICENSE.md"), "LICENSE-tesseract.md"],
    [resolve(coreDirectory, "LICENSE"), "LICENSE-core"],
    [resolve(languageDirectory, "4.0.0_best_int/eng.traineddata.gz"), "lang/eng.traineddata.gz"],
    ...[
      "tesseract-core",
      "tesseract-core-simd",
      "tesseract-core-lstm",
      "tesseract-core-simd-lstm",
      "tesseract-core-relaxedsimd",
      "tesseract-core-relaxedsimd-lstm",
    ].flatMap((name) =>
      ["wasm", "wasm.js"].map((extension) => [
        resolve(coreDirectory, `${name}.${extension}`),
        `core/${name}.${extension}`,
      ]),
    ),
  ];
  await mkdir(resolve(destination, "core"), { recursive: true });
  await mkdir(resolve(destination, "lang"), { recursive: true });
  await Promise.all(
    assets.map(([source, target]) => copyFile(source, resolve(destination, target))),
  );
  process.stdout.write(`Bundled ${assets.length} local OCR assets for ${platform}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prepareOcrAssets(process.argv[2] === "desktop" ? "desktop" : "web");
}
