import { isDeepStrictEqual } from "node:util";
import { Either, Schema } from "effect";
import { StudySyncDocumentSchema, type StudySyncDocument } from "@recall/domain";
import type { WorkspaceSyncRequest, WorkspaceSyncResponse } from "@recall/application";

const RequestSchema = Schema.Struct({
  revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  document: StudySyncDocumentSchema,
});
function preserves<T>(before: readonly T[], after: readonly T[], key: (item: T) => string) {
  const entries = new Map(after.map((item) => [key(item), item]));
  return before.every((item) => isDeepStrictEqual(entries.get(key(item)), item));
}
/** Model revision checks and immutable evidence independently from mutable settings. */
export function studyServerFixture() {
  let revision = 0;
  let document: StudySyncDocument = {
    settings: { requestRetention: 0.9 },
    adjustments: [],
    corrections: [],
    undoStates: [],
  };
  const snapshot = () => ({ revision, document });
  const handle = (request: WorkspaceSyncRequest): WorkspaceSyncResponse | undefined => {
    const paged = request.path.startsWith("/api/v1/workspace/study/pages");
    if (!paged && request.path !== "/api/v1/workspace/study") return undefined;
    if (request.method === "GET")
      return { status: 200, body: paged ? { ...snapshot(), nextCursor: null } : snapshot() };
    const decoded = Schema.decodeUnknownEither(RequestSchema)(request.body);
    if (Either.isLeft(decoded)) return { status: 400, body: { error: "invalid-request" } };
    const next = decoded.right;
    if (paged) {
      if (next.revision !== revision) return { status: 409, body: { error: "study-conflict" } };
      document = {
        settings: next.document.settings,
        adjustments: [...document.adjustments, ...next.document.adjustments],
        corrections: [...document.corrections, ...next.document.corrections],
        undoStates: [...document.undoStates, ...next.document.undoStates],
        importedSchedules: [
          ...(document.importedSchedules ?? []),
          ...(next.document.importedSchedules ?? []),
        ],
      };
      revision += 1;
      return { status: 200, body: { revision } };
    }
    if (
      next.revision !== revision ||
      !preserves(document.adjustments, next.document.adjustments, (item) => item.id) ||
      !preserves(document.corrections, next.document.corrections, (item) => item.id) ||
      !preserves(document.undoStates, next.document.undoStates, (item) => item.eventId) ||
      !preserves(
        document.importedSchedules ?? [],
        next.document.importedSchedules ?? [],
        (item) => item.cardId,
      )
    )
      return { status: 409, body: { error: "study-conflict" } };
    document = next.document;
    revision += 1;
    return { status: 200, body: snapshot() };
  };
  return { handle, snapshot };
}
