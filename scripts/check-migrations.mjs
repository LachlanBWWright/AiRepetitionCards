import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = path.join(root, "supabase/migrations");
const migrationNames = (await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right));
const failures = [];

if (migrationNames.length === 0) failures.push("No database migrations were found.");
const expectedName = /^\d{14}_[a-z0-9_]+\.sql$/;
for (const name of migrationNames) {
  if (!expectedName.test(name)) failures.push(`Invalid migration filename: ${name}`);
}

const sql = (
  await Promise.all(
    migrationNames.map((name) => readFile(path.join(migrationDirectory, name), "utf8")),
  )
).join("\n");
const tables = new Set(
  [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi)].map(
    (match) => match[1].toLowerCase(),
  ),
);
const rlsTables = new Set(
  [
    ...sql.matchAll(
      /alter\s+table\s+public\.([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi,
    ),
  ].map((match) => match[1].toLowerCase()),
);
const policyTables = new Set(
  [...sql.matchAll(/create\s+policy\s+[a-z_][a-z0-9_]*\s+on\s+public\.([a-z_][a-z0-9_]*)/gi)].map(
    (match) => match[1].toLowerCase(),
  ),
);
const ownerPolicyTables = new Set();
for (const [, table, policy] of sql.matchAll(
  /create\s+policy\s+[a-z_][a-z0-9_]*\s+on\s+public\.([a-z_][a-z0-9_]*)([^;]*);/gi,
)) {
  if (/\bto\s+authenticated\b/i.test(policy) && /\bauth\.uid\s*\(/i.test(policy)) {
    ownerPolicyTables.add(table.toLowerCase());
  }
}
const revokedTables = new Set();
for (const [, targets, roles] of sql.matchAll(/revoke\s+all\s+on\s+([^;]+?)\s+from\s+([^;]+);/gi)) {
  if (!/\banon\b/i.test(roles)) continue;
  for (const [, table] of targets.matchAll(/public\.([a-z_][a-z0-9_]*)/gi)) {
    revokedTables.add(table.toLowerCase());
  }
}

for (const table of tables) {
  if (!rlsTables.has(table)) failures.push(`public.${table} is missing row-level security.`);
  if (!policyTables.has(table) || !ownerPolicyTables.has(table)) {
    failures.push(`public.${table} is missing an authenticated owner-scoped RLS policy.`);
  }
  if (!revokedTables.has(table))
    failures.push(`public.${table} is missing an explicit anon privilege revoke.`);
}

const functions = [
  ...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)\s*\(/gi),
];
for (const match of functions) {
  const start = match.index;
  const headerEnd = sql.indexOf("as $$", start);
  const definition = sql.slice(start, headerEnd < 0 ? sql.length : headerEnd);
  if (!/\bsecurity\s+definer\b/i.test(definition)) continue;
  const functionName = match[1].toLowerCase();
  if (!/\bset\s+search_path\s*=/i.test(definition)) {
    failures.push(`SECURITY DEFINER function public.${functionName} must pin search_path.`);
  }
  const revoke = new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}\\s*\\([^;]*?\\)\\s+from\\s+([^;]+);`,
    "i",
  );
  const revokeMatch = sql.match(revoke);
  if (!revokeMatch || !/\bpublic\b/i.test(revokeMatch[1]) || !/\banon\b/i.test(revokeMatch[1])) {
    failures.push(
      `SECURITY DEFINER function public.${functionName} must revoke PUBLIC and anon execution.`,
    );
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Migration policy violations:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Migration policy passed (${migrationNames.length} migrations, ${tables.size} tables, ${functions.length} functions).\n`,
  );
}
