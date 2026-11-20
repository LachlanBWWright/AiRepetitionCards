import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Effect, Either, Schema } from "effect";
import { applyAnkiImport, createStarterWorkspace, importAnkiApkg } from "@recall/application";
import { readAnkiSqliteInDesktop } from "../../../../apps/desktop/src/main/ipc/anki-sqlite-reader";

const manifestSchema = Schema.Array(
  Schema.Struct({
    file: Schema.String,
    sha256: Schema.String,
    notes: Schema.Number,
    cards: Schema.Number,
    database: Schema.String,
    remoteMediaOmitted: Schema.Number,
  }),
);
const directory = "fixtures/anki-open-decks/";
const manifest = Schema.decodeUnknownSync(manifestSchema)(
  JSON.parse(await readFile(`${directory}manifest.json`, "utf8")) as unknown,
);
const now = new Date("2026-11-06T00:00:00Z");

for (const fixture of manifest) {
  await test(`licensed real-world Anki import and reimport: ${fixture.file}`, async () => {
    const bytes = await readFile(`${directory}${fixture.file}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256);
    const result = await Effect.runPromise(
      Effect.either(
        importAnkiApkg(new Uint8Array(bytes), { now, color: "#123456" }, readAnkiSqliteInDesktop),
      ),
    );
    assert.ok(Either.isRight(result), JSON.stringify(result));
    const imported = result.right;
    assert.equal(imported.compatibility?.omittedRemoteMedia, fixture.remoteMediaOmitted);
    if (fixture.remoteMediaOmitted > 0) {
      assert.ok(imported.warnings?.some((warning) => warning.includes("not downloaded")));
      assert.ok(
        imported.area.cards.some((card) =>
          (card.front + card.back).includes("[Remote image not included]"),
        ),
      );
    }
    const title = fixture.file.endsWith("/python.apkg")
      ? "Python"
      : fixture.file.endsWith("/bicep.apkg")
        ? "Bicep"
        : fixture.file.endsWith("/OO Design.apkg")
          ? "OO Design"
          : null;
    if (title) {
      let id = 0;
      const starter = await Effect.runPromise(
        createStarterWorkspace(now, () => `test-${String(++id)}`),
      );
      const cards = starter.areas.find((area) => area.title === title)?.cards;
      assert.deepEqual(
        cards?.map((card) => [card.sourceId, card.front, card.back]),
        imported.area.cards.map((card) => [card.sourceId, card.front, card.back]),
      );
    }
    assert.equal(imported.area.cards.length, fixture.cards);
    assert.equal(imported.provenance.noteGuids.length, fixture.notes);
    assert.ok(imported.area.cards.every((card) => card.front.trim() && card.back.trim()));
    assert.ok(imported.area.cards.every((card) => !/<script\b/i.test(card.front + card.back)));
    const workspace = await Effect.runPromise(
      applyAnkiImport({ schemaVersion: 1, areas: [], reviews: 0 }, imported),
    );
    const repeated = await Effect.runPromise(
      importAnkiApkg(new Uint8Array(bytes), { now, color: "#123456" }, readAnkiSqliteInDesktop),
    );
    const merged = await Effect.runPromise(applyAnkiImport(workspace, repeated));
    assert.equal(merged.areas.length, 1);
    assert.deepEqual(merged.areas[0]?.cards, workspace.areas[0]?.cards);
    assert.deepEqual(merged.reviewEvents, workspace.reviewEvents);
    console.info(
      JSON.stringify({
        deck: fixture.file,
        database: fixture.database,
        cards: imported.area.cards.length,
        media: imported.media.length,
        reviews: imported.reviewEvents.length,
        warnings: imported.warnings,
        changedFields: imported.compatibility.changedFieldCount,
      }),
    );
  });
}
