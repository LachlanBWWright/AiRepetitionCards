import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = [
  "apps/web/src",
  "apps/web/scripts",
  "apps/mobile/src",
  "apps/mobile/scripts",
  "apps/desktop/src",
  "packages",
];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const forbidden = [
  { name: "exception control flow", pattern: /\bthrow\s+/ },
  { name: "ESLint suppression", pattern: /eslint-disable(?:-next-line|-line)?/ },
  { name: "TypeScript suppression", pattern: /@ts-(?:ignore|nocheck|expect-error)\b/ },
];
const platformDependencies =
  /^(?:react(?:-dom)?(?:\/|$)|next(?:\/|$)|@supabase\/|expo(?:[-/]|$)|react-native(?:-web)?(?:\/|$)|electron(?:\/|$)|openai(?:\/|$)|node:|server-only$)/;
const layerRestrictions = [
  {
    layer: "packages/ui-native/src",
    pattern:
      /^(?:next(?:\/|$)|@supabase\/|expo(?:[-/]|$)|electron(?:\/|$)|openai(?:\/|$)|node:|server-only$)/,
  },
  {
    layer: "packages/ui-web/src",
    pattern:
      /^(?:next(?:\/|$)|@supabase\/|expo(?:[-/]|$)|react-native(?:-web)?(?:\/|$)|electron(?:\/|$)|openai(?:\/|$)|node:|server-only$)/,
  },
  ...["domain", "scheduler", "application", "sync-core", "ai-core", "contracts", "local-store"].map(
    (name) => ({ layer: `packages/${name}/src`, pattern: platformDependencies }),
  ),
  {
    layer: "packages/infra-openai/src",
    pattern:
      /^(?:react(?:-dom)?(?:\/|$)|next(?:\/|$)|@supabase\/|expo(?:[-/]|$)|react-native(?:-web)?(?:\/|$)|electron(?:\/|$)|node:|server-only$)/,
  },
  {
    layer: "packages/infra-supabase/src",
    pattern:
      /^(?:react(?:-dom)?(?:\/|$)|next(?:\/|$)|expo(?:[-/]|$)|react-native(?:-web)?(?:\/|$)|electron(?:\/|$)|openai(?:\/|$)|node:|server-only$)/,
  },
];

// Keep the workspace graph explicit as well as rejecting direct vendor SDKs.
// Subpath exports inherit their owning package's boundary.
const allowedWorkspaceDependencies = {
  verification: [
    "domain",
    "scheduler",
    "sync-core",
    "application",
    "ai-core",
    "contracts",
    "infra-openai",
  ],
  domain: [],
  scheduler: ["domain", "sync-core"],
  "sync-core": ["domain", "contracts"],
  "ai-core": ["domain"],
  contracts: ["domain"],
  "local-store": ["domain"],
  application: ["domain", "scheduler", "sync-core", "ai-core", "contracts", "local-store"],
  "infra-openai": ["ai-core", "application", "contracts", "domain"],
  "infra-supabase": ["ai-core", "application", "contracts", "domain", "sync-core"],
  "design-tokens": [],
  "ui-web": ["design-tokens"],
  "ui-native": ["design-tokens"],
};

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
  join(process.cwd(), "apps/mobile/app.config.ts"),
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
  const packageName = /^packages\/([^/]+)\/src\//.exec(relativeFile)?.[1];
  if (packageName && Object.hasOwn(allowedWorkspaceDependencies, packageName)) {
    const allowed = allowedWorkspaceDependencies[packageName];
    const imports = content.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](@recall\/[^"']+)["']/g,
    );
    for (const [, specifier] of imports) {
      const dependency = specifier.split("/")[1];
      if (dependency !== packageName && !allowed.includes(dependency)) {
        violations.push(
          `${relativeFile}: workspace dependency ${specifier} is outside this package layer`,
        );
      }
    }
  }
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
