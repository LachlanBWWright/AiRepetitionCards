import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { createStudySearchIndex, searchStudyCards, recordReview } from "@recall/application";
import { createAssessmentId, createReviewEventId } from "@recall/domain";
import { workspace, card, now } from "../tests/review/advanced/fixtures";
import {
  readDesktopWorkspaceSnapshot,
  writeDesktopWorkspaceSnapshot,
} from "../../../apps/desktop/src/main/ipc/workspace-snapshot-chunks";

const count = 50_000;
const initial = workspace();
const collection = {
  ...initial,
  areas: initial.areas.map((area) => ({
    ...area,
    cards: Array.from({ length: count }, (_, row) => ({
      ...card("entry"),
      id: createAssessmentId(`entry-${String(row)}`),
      front: `Question ${String(row)} about ${row === count - 1 ? "mitochondrion" : "biology"}`,
    })),
  })),
};
const results: Record<string, number> = { cards: count };
function measure<T>(name: string, operation: () => T): T {
  const start = performance.now();
  const value = operation();
  results[`${name}Ms`] = performance.now() - start;
  return value;
}
const database = new DatabaseSync(":memory:");
database.exec(
  "CREATE TABLE local_workspace(id INTEGER PRIMARY KEY,serialized_workspace TEXT,updated_at TEXT); CREATE TABLE local_workspace_chunks(part INTEGER PRIMARY KEY,payload TEXT); CREATE TABLE chunk_writes(part INTEGER); CREATE TRIGGER count_update AFTER UPDATE ON local_workspace_chunks BEGIN INSERT INTO chunk_writes VALUES(new.part); END;",
);
const payload = measure("serialize", () => JSON.stringify(collection));
results.bytes = new TextEncoder().encode(payload).byteLength;
measure("initialWrite", () => writeDesktopWorkspaceSnapshot(database, payload));
measure("openRead", () => readDesktopWorkspaceSnapshot(database));
const index = measure("buildIndex", () => createStudySearchIndex(collection));
measure("search", () =>
  Effect.runSync(searchStudyCards(collection, "mitochondrion", now, undefined, index)),
);
const reviewed = measure("recordReview", () =>
  Effect.runSync(
    recordReview({
      workspace: collection,
      areaId: initial.areas[0]?.id,
      cardId: createAssessmentId("entry-0"),
      eventId: createReviewEventId("benchmark-review"),
      ratedAt: new Date(now).toISOString(),
      rating: "good",
    }),
  ),
).workspace;
const reviewIndex = measure("reviewReindex", () => createStudySearchIndex(reviewed, index));
results.reusedReviewPostings = Number(reviewIndex.postings === index.postings);
measure("reviewSerializeAndWrite", () =>
  writeDesktopWorkspaceSnapshot(database, JSON.stringify(reviewed)),
);
database.exec("DELETE FROM chunk_writes");
// Constant-length edit isolates the cost of updating one persisted chunk from offset shifts.
const edited = JSON.stringify(reviewed).replace("mitochondrion", "MITOCHONDRION");
measure("editWrite", () => writeDesktopWorkspaceSnapshot(database, edited));
results.updatedChunks = Number(
  database.prepare("SELECT count(*) AS count FROM chunk_writes").get()?.count,
);
measure("backupRead", () => readDesktopWorkspaceSnapshot(database));
measure("backupEncode", () => new TextEncoder().encode(edited));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
database.close();
