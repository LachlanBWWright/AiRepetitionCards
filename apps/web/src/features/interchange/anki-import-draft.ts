import { coordinateLocalWrite } from "../workspace/local-write-coordinator";
import { Effect } from "effect";

const databaseName = "recall-anki-import-draft";
const storeName = "packages";
function withDraftStore<A>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<A>,
): Effect.Effect<A, { readonly _tag: "ImportDraftUnavailable" }> {
  return Effect.try({
    try: () => indexedDB.open(databaseName, 1),
    catch: () => ({ _tag: "ImportDraftUnavailable" }) as const,
  }).pipe(
    Effect.flatMap((open) =>
      Effect.async<A, { readonly _tag: "ImportDraftUnavailable" }>((resume) => {
        let settled = false;
        let database: IDBDatabase | undefined;
        let transaction: IDBTransaction | undefined;
        const failed = () => {
          if (settled) return;
          settled = true;
          database?.close();
          resume(Effect.fail({ _tag: "ImportDraftUnavailable" }));
        };
        open.onupgradeneeded = () => open.result.createObjectStore(storeName);
        open.onerror = failed;
        open.onblocked = failed;
        open.onsuccess = () => {
          database = open.result;
          if (settled) {
            database.close();
            return;
          }
          try {
            transaction = database.transaction(storeName, mode);
            const request = operation(transaction.objectStore(storeName));
            transaction.oncomplete = () => {
              database?.close();
              if (settled) return;
              settled = true;
              resume(Effect.succeed(request.result));
            };
            transaction.onerror = failed;
            transaction.onabort = failed;
          } catch {
            failed();
          }
        };
        return Effect.sync(() => {
          settled = true;
          if (transaction) {
            try {
              transaction.abort();
            } catch {
              /* Already committed or aborted. */
            }
          }
          database?.close();
          open.onsuccess = () => {
            open.result.close();
          };
        });
      }),
    ),
  );
}
const unavailable = () => ({ _tag: "ImportDraftUnavailable" }) as const;
export const saveAnkiDraft = (file: File) =>
  coordinateLocalWrite(
    withDraftStore("readwrite", (store) => store.put(file, "pending")),
    unavailable,
  );
/** Used while the erasure coordinator already holds the write permit. */
export const eraseAnkiDraft = () => withDraftStore("readwrite", (store) => store.delete("pending"));
export const clearAnkiDraft = () => coordinateLocalWrite(eraseAnkiDraft(), unavailable, true);
export const readAnkiDraft = () =>
  coordinateLocalWrite(
    withDraftStore<unknown>("readonly", (store) => store.get("pending")),
    unavailable,
  ).pipe(Effect.map((value) => (value instanceof File ? value : null)));
