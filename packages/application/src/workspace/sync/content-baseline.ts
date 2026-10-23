import { sha256 } from "@noble/hashes/sha2.js";
import { Effect } from "effect";
import type { LearningArea, Workspace } from "@recall/domain";
import { toKnowledgeArea } from "../../interchange/knowledge-area-interchange";
import { canonicalPublicationJson } from "../../publishing/publication-content-hash";
import { failure, type Snapshot } from "./workspace-sync-snapshots";

/** Scheduling and sync receipts do not make authored content dirty. */
export function workspaceContentFingerprints(workspace: Pick<Workspace, "areas">) {
  return Effect.forEach(workspace.areas, (area) =>
    toKnowledgeArea(area, true, true).pipe(
      Effect.mapError(() => failure("content")),
      Effect.map((document) => {
        const content = canonicalPublicationJson({ document, color: area.color });
        const hash = Array.from(sha256(new TextEncoder().encode(content)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        return [area.id, hash] as const;
      }),
    ),
  ).pipe(Effect.map((entries) => Object.fromEntries(entries)));
}

/** An unchanged local copy can accept remote edits without treating them as an overlap. */
export function existingContentForSync(
  prepared: Workspace,
  before: Snapshot,
  local: ReadonlyMap<string, LearningArea>,
  deleted: ReadonlySet<string>,
  staged: ReadonlySet<string>,
) {
  return Effect.gen(function* () {
    const fingerprints = yield* workspaceContentFingerprints(prepared);
    return yield* Effect.forEach(
      before.areas.filter(
        (area) => !deleted.has(area.document.id) && !staged.has(area.document.id),
      ),
      (remote) => {
        const area = local.get(remote.document.id);
        const baseContentHash = prepared.syncContentHashes?.[remote.document.id];
        const unchanged =
          area &&
          prepared.syncContentFingerprints?.[area.id] !== undefined &&
          prepared.syncContentFingerprints[area.id] === fingerprints[area.id];
        if (unchanged || !area || !baseContentHash)
          return Effect.succeed({ ...remote, baseContentHash: remote.contentHash });
        return toKnowledgeArea(area, true, true).pipe(
          Effect.mapError(() => failure("content")),
          Effect.map((document) => ({ document, color: area.color, baseContentHash })),
        );
      },
    );
  });
}
