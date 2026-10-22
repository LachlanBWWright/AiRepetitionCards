import { Effect, Schema } from "effect";
import type { StudySyncDocument } from "@recall/domain";
import { WorkspaceStudyBatchReplySchema, WorkspaceStudyPageSchema } from "@recall/contracts";
import type {
  WorkspaceSyncFailure,
  WorkspaceSyncRequest,
  WorkspaceSyncResponse,
} from "./workspace-sync";
const failure = (conflict = false): WorkspaceSyncFailure => ({
  _tag: "WorkspaceSyncFailure",
  reason: conflict ? "study-conflict" : "study-settings",
});
type Request = (
  input: WorkspaceSyncRequest,
) => Effect.Effect<WorkspaceSyncResponse, WorkspaceSyncFailure>;
const fields = ["adjustments", "corrections", "undoStates", "importedSchedules"] as const;
export function readStudyPages(request: Request) {
  return Effect.gen(function* () {
    let cursor = 0;
    let revision: number | undefined;
    const documents: StudySyncDocument[] = [];
    // Defensive upper bound is independent of per-page count; never truncate at this boundary.
    for (let page = 0; page < 2_000; page += 1) {
      const response = yield* request({
        path: `/api/v1/workspace/study/pages?after=${String(cursor)}`,
        method: "GET",
      });
      if (response.status !== 200) return yield* Effect.fail(failure());
      const result = yield* Schema.decodeUnknown(WorkspaceStudyPageSchema)(response.body).pipe(
        Effect.mapError(() => failure()),
      );
      if (revision !== undefined && revision !== result.revision)
        return yield* Effect.fail(failure(true));
      revision = result.revision;
      documents.push(result.document);
      if (result.nextCursor === null) {
        return {
          revision,
          document: {
            settings: result.document.settings,
            adjustments: documents.flatMap((document) => document.adjustments),
            corrections: documents.flatMap((document) => document.corrections),
            undoStates: documents.flatMap((document) => document.undoStates),
            importedSchedules: documents.flatMap((document) => document.importedSchedules ?? []),
          },
        };
      }
      if (result.nextCursor <= cursor) return yield* Effect.fail(failure());
      cursor = result.nextCursor;
    }
    return yield* Effect.fail(failure());
  });
}
const key = (field: (typeof fields)[number], item: unknown) => {
  if (item === null || typeof item !== "object") return "";
  const name = field === "undoStates" ? "eventId" : field === "importedSchedules" ? "cardId" : "id";
  const value: unknown = Object.entries(item).find(([property]) => property === name)?.[1];
  return typeof value === "string" ? value : "";
};
/** Send only new immutable entries, preserving remote history without retransmitting it. */
export function writeStudyBatches(
  request: Request,
  revision: number,
  document: StudySyncDocument,
  remote: StudySyncDocument,
) {
  return Effect.gen(function* () {
    const pending = fields.flatMap((field) => {
      const known = new Set((remote[field] ?? []).map((entry) => key(field, entry)));
      return (document[field] ?? [])
        .filter((entry) => !known.has(key(field, entry)))
        .map((entry) => ({ field, entry }));
    });
    let nextRevision = revision;
    let offset = 0;
    do {
      const batch: Record<string, unknown[]> = Object.fromEntries(
        fields.map((field) => [field, []]),
      );
      let count = 0;
      let bytes = new TextEncoder().encode(JSON.stringify(document.settings)).byteLength + 512;
      if (bytes > 4_800_000) return yield* Effect.fail(failure());
      while (offset < pending.length && count < 5000) {
        const item = pending[offset];
        if (!item) break;
        const bucket = batch[item.field];
        if (!bucket) return yield* Effect.fail(failure());
        const itemBytes = new TextEncoder().encode(JSON.stringify(item.entry)).byteLength + 1;
        if (bytes + itemBytes > 4_800_000) {
          if (count === 0) return yield* Effect.fail(failure());
          break;
        }
        bytes += itemBytes;
        bucket.push(item.entry);
        offset += 1;
        count += 1;
      }
      const response = yield* request({
        path: "/api/v1/workspace/study/pages",
        method: "POST",
        body: { revision: nextRevision, document: { settings: document.settings, ...batch } },
      });
      if (response.status !== 200) return yield* Effect.fail(failure(response.status === 409));
      const accepted = yield* Schema.decodeUnknown(WorkspaceStudyBatchReplySchema)(
        response.body,
      ).pipe(Effect.mapError(() => failure()));
      if (accepted.revision !== nextRevision + 1) return yield* Effect.fail(failure());
      nextRevision = accepted.revision;
    } while (offset < pending.length);
    return nextRevision;
  });
}
