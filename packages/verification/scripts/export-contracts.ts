import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { JSONSchema } from "effect";
import { AuthSessionResponseSchema, WorkspaceSnapshotSchema } from "@recall/contracts";

const directory = resolve(process.argv[2] ?? ".", "contracts/generated");
await mkdir(directory, { recursive: true });
const schemas = {
  "auth-session": JSONSchema.make(AuthSessionResponseSchema),
  "workspace-snapshot": JSONSchema.make(WorkspaceSnapshotSchema),
};
for (const [name, schema] of Object.entries(schemas)) {
  const path = resolve(directory, `${name}.schema.json`);
  const content = `${JSON.stringify(schema, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing !== content) {
      process.stderr.write(`Generated contract is stale: ${name}. Run pnpm contracts:generate.\n`);
      process.exitCode = 1;
    }
  } else await writeFile(path, content);
}
