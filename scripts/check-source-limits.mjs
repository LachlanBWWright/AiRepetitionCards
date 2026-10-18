import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);
const maxLines = 400;
const maxIndentationLevels = 8;
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".cs",
  ".fs",
  ".fsx",
  ".sql",
  ".py",
  ".swift",
  ".kt",
  ".kts",
  ".java",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".vue",
  ".svelte",
  ".xml",
  ".xaml",
  ".sh",
  ".bash",
  ".ps1",
  ".psm1",
  ".gradle",
  ".groovy",
  ".rb",
  ".podspec",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".m",
  ".mm",
  ".rs",
  ".go",
  ".php",
]);
const fourSpaceExtensions = new Set([".cs", ".fs", ".fsx", ".py", ".java", ".rs", ".php"]);
const excludedDirectories = new Set([
  "node_modules",
  ".git",
  ".next",
  ".expo",
  ".turbo",
  ".gradle",
  "__pycache__",
  "out",
  "dist",
  "build",
  "release",
  "bin",
  "obj",
  "coverage",
  "vendor",
  "storybook-static",
]);
// These files are outputs of the Supabase CLI, token generator, and Next.js.
const generatedFiles = new Set([
  "packages/infra-supabase/src/database.types.ts",
  "packages/design-tokens/src/index.ts",
  "packages/design-tokens/src/tokens.css",
]);

export function isAuthoredSource(file) {
  const normalized = file.replaceAll("\\", "/");
  if (!sourceExtensions.has(extname(normalized))) return false;
  if (normalized.split("/").some((part) => excludedDirectories.has(part))) return false;
  if (generatedFiles.has(normalized) || normalized.endsWith("/next-env.d.ts")) return false;
  if (/\.(?:generated|g|designer)\.[^.]+$/i.test(normalized)) return false;
  if (/^apps\/mobile\/(?:android|ios)\//.test(normalized)) return false;
  if (/^apps\/web\/public\/(?:app-shell\/|service-worker\.js$|index\.html$)/.test(normalized))
    return false;
  return true;
}

export function inspectSource(file, source) {
  const lines = source.length === 0 ? [] : source.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const indentationWidth = fourSpaceExtensions.has(extname(file)) ? 4 : 2;
  let deepest = null;
  let indentedLines = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const whitespace = /^[\t ]*/.exec(line)?.[0] ?? "";
    // A tab advances to the next indentation stop, including after spaces.
    let columns = 0;
    for (const character of whitespace) {
      columns += character === "\t" ? indentationWidth - (columns % indentationWidth) : 1;
    }
    const level = Math.ceil(columns / indentationWidth);
    if (level <= maxIndentationLevels) continue;
    indentedLines += 1;
    if (deepest === null || level > deepest.level) deepest = { line: index + 1, level };
  }
  return {
    file,
    lineCount: lines.length,
    tooLong: lines.length > maxLines,
    deepest,
    indentedLines,
  };
}

async function sourceFiles(requested) {
  if (requested.length > 0)
    return requested.map((file) => relative(root, resolve(file)).replaceAll("\\", "/"));
  const result = await execute(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  );
  return result.stdout.split("\0");
}

export function formatReport(results) {
  const byFile = (left, right) => left.file.localeCompare(right.file, "en");
  const indented = results
    .filter((result) => result.deepest !== null)
    .sort((left, right) => right.deepest.level - left.deepest.level || byFile(left, right));
  const oversized = results
    .filter((result) => result.tooLong)
    .sort((left, right) => right.lineCount - left.lineCount || byFile(left, right));
  const indentationLines = indented.map(
    (result) =>
      `${result.file}:${result.deepest.line}:1: indentation level ${result.deepest.level}; maximum ${maxIndentationLevels} (${result.indentedLines} lines over limit).`,
  );
  const sizeLines = oversized.map(
    (result) => `${result.file}:401:1: ${result.lineCount} lines; maximum ${maxLines}.`,
  );
  return {
    failed: indented.length > 0 || oversized.length > 0,
    text: [
      `Indentation (maximum ${maxIndentationLevels} levels; highest first)`,
      ...(indentationLines.length > 0 ? indentationLines : ["No indentation violations."]),
      "",
      `Line count (maximum ${maxLines} lines; highest first)`,
      ...(sizeLines.length > 0 ? sizeLines : ["No line-count violations."]),
      "",
      `Source limits: ${results.length} files checked; ${oversized.length} over ${maxLines} lines; ${indented.length} exceed ${maxIndentationLevels} indentation levels.`,
      "",
    ].join("\n"),
  };
}

async function checkFiles() {
  const requested = process.argv.slice(2);
  const files = await sourceFiles(requested);
  const results = [];
  for (const file of [...new Set(files)].filter(isAuthoredSource).sort()) {
    const contents = await readFile(resolve(root, file), "utf8").then(
      (source) => ({ source }),
      (error) => ({ error }),
    );
    // Git includes tracked files deleted from the working tree.
    if ("error" in contents) {
      if (requested.length === 0 && contents.error?.code === "ENOENT") continue;
      process.stderr.write(`${file}: could not read source (${String(contents.error?.code)}).\n`);
      process.exitCode = 1;
      continue;
    }
    results.push(inspectSource(file, contents.source));
  }
  const report = formatReport(results);
  process.stdout.write(report.text);
  if (report.failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkFiles().catch((error) => {
    process.stderr.write(
      `Source limit check failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
