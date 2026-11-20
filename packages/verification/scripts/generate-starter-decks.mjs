import { build, stop } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "recall-starters-"));
try {
  const output = path.join(temporary, "generate.mjs");
  await build({
    stdin: {
      resolveDir: path.join(root, "packages/verification"),
      loader: "ts",
      contents: `
import { Effect } from "effect";
import { importAnkiApkg } from "../application/src/index";
import { readAnkiSqliteInDesktop } from "../../apps/desktop/src/main/ipc/anki-sqlite-reader";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = ${JSON.stringify(root)};
const fixtures = root + "/packages/verification/fixtures/anki-open-decks/";
const target = root + "/packages/application/src/workspace/starters/data/";
await mkdir(target, { recursive: true });
const sources = [
  ["python", "tltaylor1/python.apkg"],
  ["bicep", "tltaylor1/bicep.apkg"],
  ["oo-design", "system-design-primer/OO Design.apkg"],
];
const manifest = JSON.parse(await readFile(fixtures + "manifest.json", "utf8"));
for (const [name, file] of sources) {
  const bytes = await readFile(fixtures + file);
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.find((entry) => entry.file === file)?.sha256)
    process.exit(1);
  const proposal = await Effect.runPromise(importAnkiApkg(new Uint8Array(bytes), {
    now: new Date("2026-11-06T00:00:00Z"), color: "#123456",
  }, readAnkiSqliteInDesktop));
  const cards = proposal.area.cards.map((card) => [card.sourceId, card.front, card.back]);
  for (let offset = 0; offset < cards.length; offset += 40) {
    const rows = cards.slice(offset, offset + 40);
    const content = "// CC BY 4.0; source, attribution and conversion details in ../README.md.\\n"
      + "export default " + JSON.stringify(rows, null, 2) + " as const;\\n";
    await writeFile(target + name + "-" + String(offset / 40 + 1) + ".ts", content);
  }
}
`,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: output,
    banner: {
      js: 'import { createRequire as starterCreateRequire } from "node:module"; const require = starterCreateRequire(import.meta.url);',
    },
    logLevel: "warning",
  });
  await import(pathToFileURL(output).href);
} finally {
  await stop();
  await rm(temporary, { recursive: true, force: true });
}
