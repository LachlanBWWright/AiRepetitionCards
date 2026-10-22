import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Effect } from "effect";
import { exportAnkiApkg, importAnkiApkg, type AnkiSqliteWriter } from "@recall/application";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type LearningArea,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { readAnkiSqliteInDesktop } from "../../../../apps/desktop/src/main/ipc/anki-sqlite-reader";

/** Opt in with RECALL_TEST_ANKI_BACKEND=1 and a Python environment containing the anki wheel. */
await test(
  "real Anki backend accepts Recall and exports a modern package Recall can read",
  { skip: process.env.RECALL_TEST_ANKI_BACKEND !== "1" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "recall-anki-backend-"));
    try {
      const now = new Date();
      const writer: AnkiSqliteWriter = (statements) =>
        Effect.tryPromise({
          try: async () => {
            const path = join(directory, "export.sqlite");
            const database = new DatabaseSync(path);
            try {
              for (const statement of statements) {
                if (statement.parameters.length === 0) database.exec(statement.sql);
                else database.prepare(statement.sql).run(...statement.parameters);
              }
            } finally {
              database.close();
            }
            return new Uint8Array(await readFile(path));
          },
          catch: () => ({ _tag: "AnkiExportFailure", reason: "database-failed" }),
        });
      const area: LearningArea = {
        id: createAreaId("backend-area"),
        title: "Recall acceptance",
        color: "#123456",
        cards: [
          {
            id: createAssessmentId("forward"),
            front: "cat",
            back: "chat",
            objective: "Vocabulary",
            schedule: {
              ...newSchedule(now),
              state: 2,
              stability: 20,
              difficulty: 6,
              reps: 1,
              scheduled_days: 12,
            },
            noteId: "word",
            templateId: "forward",
          },
          {
            id: createAssessmentId("reverse"),
            front: "chat",
            back: "cat",
            objective: "Vocabulary",
            schedule: newSchedule(now),
            noteId: "word",
            templateId: "reverse",
          },
        ],
        noteLibrary: {
          types: [
            {
              id: "words",
              name: "Recall custom words",
              fields: [{ name: "English" }, { name: "French" }],
              templates: [
                { id: "forward", name: "Forward", front: "{{English}}", back: "{{French}}" },
                { id: "reverse", name: "Reverse", front: "{{French}}", back: "{{English}}" },
              ],
            },
          ],
          notes: [
            {
              id: "word",
              typeId: "words",
              fields: { English: "cat", French: "chat" },
              tags: ["acceptance"],
              objectiveIds: [],
            },
          ],
        },
      };
      const event = {
        id: createReviewEventId("actual"),
        areaId: area.id,
        cardId: createAssessmentId("forward"),
        ratedAt: new Date(now.getTime() - 86400000).toISOString(),
        rating: "good" as const,
        schedulerFamily: "fsrs" as const,
        schedulerVersion: "acceptance",
        elapsedMs: 1500,
      };
      const media = {
        get: () => Effect.succeed(null),
        put: () => Effect.void,
        delete: () => Effect.void,
        list: Effect.succeed([]),
      };
      const packagePath = join(directory, "recall.apkg");
      const returnPath = join(directory, "anki.apkg");
      const backupPath = join(directory, "anki.colpkg");
      await writeFile(
        packagePath,
        await Effect.runPromise(
          exportAnkiApkg(area, media, writer, {
            now,
            includeScheduling: true,
            reviewEvents: [event],
            suspendedCardIds: [event.cardId],
          }),
        ),
      );
      const python = spawnSync(
        "python3",
        [
          "-c",
          `
import sys
from anki.collection import Collection
from anki.import_export_pb2 import ImportAnkiPackageRequest, ImportAnkiPackageOptions, ExportAnkiPackageOptions, ExportLimit
col = Collection(sys.argv[1])
try:
    col.import_anki_package(ImportAnkiPackageRequest(package_path=sys.argv[2], options=ImportAnkiPackageOptions(with_scheduling=True)))
    assert col.card_count() == 2 and col.note_count() == 1
    assert col.db.scalar('select count(*) from revlog') == 1
    assert col.db.scalar('select queue from cards where ord=0') == -1
    assert col.db.scalar('select ease from revlog') == 3
    assert col.db.scalar('select time from revlog') == 1500
    assert '20' in col.db.scalar('select data from cards where ord=0')
    col.export_anki_package(out_path=sys.argv[3], options=ExportAnkiPackageOptions(with_scheduling=True, with_media=True), limit=ExportLimit(whole_collection={}))
    col.export_collection_package(sys.argv[4], include_media=True, legacy=False)
finally:
    col.close()
`,
          join(directory, "collection.anki2"),
          packagePath,
          returnPath,
          backupPath,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      assert.equal(python.status, 0, python.stderr || python.stdout);
      const returned = await Effect.runPromise(
        importAnkiApkg(
          new Uint8Array(await readFile(returnPath)),
          { now, color: "#123456" },
          readAnkiSqliteInDesktop,
        ),
      );
      assert.equal(returned.area.cards.length, 2);
      assert.equal(returned.area.noteLibrary?.notes.length, 1);
      assert.equal(returned.reviewEvents.length, 1);
      assert.equal(returned.reviewEvents.at(0)?.elapsedMs, 1500);
      assert.equal(returned.area.cards.at(0)?.schedule.stability, 20);
      assert.equal(returned.suspendedCardIds?.length, 1);
      const backup = await Effect.runPromise(
        importAnkiApkg(
          new Uint8Array(await readFile(backupPath)),
          { now, color: "#123456" },
          readAnkiSqliteInDesktop,
        ),
      );
      assert.equal(backup.area.cards.length, 2);
      assert.equal(backup.reviewEvents.length, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
