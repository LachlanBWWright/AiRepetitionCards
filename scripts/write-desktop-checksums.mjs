import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const releaseDirectory = "apps/desktop/release";
const manifestName = "checksums.json";
const installerExtensions = new Set([".appimage", ".dmg", ".zip", ".exe"]);

function reportFilesystemError(error, action) {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "unknown";
  const message =
    code === "ENOENT"
      ? `No desktop installers found in ${releaseDirectory}`
      : `Unable to ${action} in ${releaseDirectory} (${code})`;
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function writeManifest() {
  let entries;
  try {
    entries = await readdir(releaseDirectory, { withFileTypes: true });
  } catch (error) {
    reportFilesystemError(error, "read desktop installer outputs");
    return;
  }

  const installerEntries = entries.filter(
    (entry) => entry.isFile() && installerExtensions.has(extname(entry.name).toLowerCase()),
  );
  if (installerEntries.length === 0) {
    process.stderr.write(`No desktop installers found in ${releaseDirectory}\n`);
    process.exitCode = 1;
    return;
  }

  const artifacts = [];
  try {
    for (const entry of installerEntries) {
      const bytes = await readFile(join(releaseDirectory, entry.name));
      artifacts.push({
        file: entry.name,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }

    artifacts.sort((left, right) => left.file.localeCompare(right.file));
    await writeFile(
      join(releaseDirectory, manifestName),
      `${JSON.stringify({ algorithm: "SHA-256", artifacts }, null, 2)}\n`,
    );
  } catch (error) {
    reportFilesystemError(error, "create checksum manifest");
  }
}

await writeManifest();
