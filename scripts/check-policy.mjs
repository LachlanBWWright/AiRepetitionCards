import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["apps/web/src", "apps/mobile/src", "apps/desktop/src", "packages"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const forbidden = [
  { name: "exception control flow", pattern: /\bthrow\s+/ },
  { name: "ESLint suppression", pattern: /eslint-disable(?:-next-line|-line)?/ },
  { name: "TypeScript suppression", pattern: /@ts-(?:ignore|nocheck|expect-error)\b/ },
];
const layerRestrictions = [
  {
    layer: "packages/domain/src",
    pattern: /^(?:react(?:-dom)?|next|@supabase\/|expo(?:-|\/)|react-native(?:-web)?)(?:\/|$)/,
  },
  {
    layer: "packages/scheduler/src",
    pattern: /^(?:react(?:-dom)?|next|@supabase\/|expo(?:-|\/)|react-native(?:-web)?)(?:\/|$)/,
  },
  {
    layer: "packages/application/src",
    pattern: /^(?:react(?:-dom)?|next|@supabase\/|expo(?:-|\/)|react-native(?:-web)?)(?:\/|$)/,
  },
  {
    layer: "packages/sync-core/src",
    pattern: /^(?:react(?:-dom)?|next|@supabase\/|expo(?:-|\/)|react-native(?:-web)?)(?:\/|$)/,
  },
  {
    layer: "packages/ai-core/src",
    pattern:
      /^(?:react(?:-dom)?|next|@supabase\/|expo(?:-|\/)|react-native(?:-web)?|openai)(?:\/|$)/,
  },
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return extensions.has(path.slice(path.lastIndexOf("."))) ? [path] : [];
    }),
  );
  return nested.flat();
}

const files = [
  ...(await Promise.all(roots.map(sourceFiles))).flat(),
  join(process.cwd(), "apps/mobile/App.tsx"),
  join(process.cwd(), "apps/mobile/index.js"),
];
const violations = [];

for (const file of files) {
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        violations.push(`${relative(process.cwd(), file)}:${index + 1}: ${rule.name}`);
      }
    }
  }

  const relativeFile = relative(process.cwd(), file).replaceAll("\\", "/");
  for (const restriction of layerRestrictions) {
    if (!relativeFile.startsWith(`${restriction.layer}/`)) continue;
    const imports = content.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*["']([^"']+)["']/g);
    for (const [, specifier] of imports) {
      if (restriction.pattern.test(specifier)) {
        violations.push(`${relativeFile}: dependency ${specifier} is outside this package layer`);
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Source policy violations:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Source policy passed (${files.length} files checked).\n`);
}
