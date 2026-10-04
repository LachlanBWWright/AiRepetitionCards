import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const releaseDirectory = "apps/desktop/release";
const manifestName = "checksums.json";
const installerExtensions = new Set([".appimage", ".dmg", ".zip", ".exe"]);
const platformExtensions = {
  linux: [".appimage"],
  mac: [".dmg", ".zip"],
  windows: [".exe"],
};
const platform = process.argv.find((argument) => argument.startsWith("--platform="))?.slice(11);
const architecture = process.argv.find((argument) => argument.startsWith("--arch="))?.slice(7);
// AppImage uses Linux's x86_64/aarch64 names for Electron's x64/arm64 targets.
const artifactArchitectures =
  platform === "linux" && architecture === "x64"
    ? ["x64", "x86_64"]
    : platform === "linux" && architecture === "arm64"
      ? ["arm64", "aarch64"]
      : [architecture];

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
  if (
    (platform !== undefined && !Object.hasOwn(platformExtensions, platform)) ||
    (architecture !== undefined && !["x64", "arm64"].includes(architecture))
  ) {
    process.stderr.write("Unsupported desktop artifact platform or architecture\n");
    process.exitCode = 1;
    return;
  }
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

  if (platform !== undefined) {
    const missingExtensions = platformExtensions[platform].filter(
      (extension) =>
        !installerEntries.some(
          (entry) =>
            extname(entry.name).toLowerCase() === extension &&
            (architecture === undefined ||
              artifactArchitectures.some((name) =>
                entry.name.endsWith(`-${name}${extname(entry.name)}`),
              )),
        ),
    );
    if (missingExtensions.length > 0) {
      process.stderr.write(
        `Missing ${platform}/${architecture ?? "any"} desktop installers: ${missingExtensions.join(", ")}\n`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const artifacts = [];
  try {
    for (const entry of installerEntries) {
      const bytes = await readFile(join(releaseDirectory, entry.name));
      if (bytes.byteLength === 0) {
        process.stderr.write(`Empty desktop installer: ${entry.name}\n`);
        process.exitCode = 1;
        return;
      }
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
