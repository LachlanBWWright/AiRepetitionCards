import { Either, Schema } from "effect";
import { WorkspaceStudyPageSchema } from "@recall/contracts";
import type { StudySyncDocument } from "@recall/domain";
import type { RecallSupabaseClient } from "../client";
/** Export reads the same revision-fenced pages as study sync, including normalized history. */
export async function readAccountStudyDocument(
  client: RecallSupabaseClient,
): Promise<StudySyncDocument | null> {
  const documents: StudySyncDocument[] = [];
  let cursor = 0;
  let revision: number | undefined;
  for (let page = 0; page < 2_000; page += 1) {
    const result = await client.rpc("read_workspace_study_page", {
      p_after: cursor,
      p_limit: 5_000,
    });
    if (result.error) return null;
    const decoded = Schema.decodeUnknownEither(WorkspaceStudyPageSchema)(result.data);
    if (Either.isLeft(decoded)) return null;
    const value = decoded.right;
    if (revision !== undefined && revision !== value.revision) return null;
    revision = value.revision;
    documents.push(value.document);
    if (value.nextCursor === null)
      return {
        settings: value.document.settings,
        adjustments: documents.flatMap((document) => document.adjustments),
        corrections: documents.flatMap((document) => document.corrections),
        undoStates: documents.flatMap((document) => document.undoStates),
        importedSchedules: documents.flatMap((document) => document.importedSchedules ?? []),
      };
    if (value.nextCursor <= cursor) return null;
    cursor = value.nextCursor;
  }
  return null;
}
