import { Effect, Either, Schema } from "effect";
import { WorkspaceSnapshotSchema } from "@recall/contracts";
import { type Workspace } from "@recall/domain";
import { fromKnowledgeArea } from "../../interchange/knowledge-area-interchange";
import { applyWorkspaceContentConflict } from "./workspace-sync";
import type {
  WorkspaceSyncFailure,
  WorkspaceSyncResponse,
  WorkspaceSyncInput,
} from "./workspace-sync";
export type Snapshot = typeof WorkspaceSnapshotSchema.Type;
export const failure = (reason: WorkspaceSyncFailure["reason"]): WorkspaceSyncFailure => ({
  _tag: "WorkspaceSyncFailure",
  reason,
});
export const successful = (response: WorkspaceSyncResponse): boolean =>
  response.status >= 200 && response.status < 300;
export function snapshotFrom(
  response: WorkspaceSyncResponse,
): Effect.Effect<Snapshot, WorkspaceSyncFailure> {
  const decoded = Schema.decodeUnknownEither(WorkspaceSnapshotSchema)(response.body);
  return successful(response) && Either.isRight(decoded)
    ? Effect.succeed(decoded.right)
    : Effect.fail(failure("content"));
}
export function snapshotAreas(snapshot: Snapshot, input: WorkspaceSyncInput, workspace: Workspace) {
  return Effect.forEach(snapshot.areas, (remote) =>
    fromKnowledgeArea(remote.document, remote.color, true, input.createId, input.now, true).pipe(
      Effect.mapError(() => failure("content")),
      Effect.map((area) => {
        const previous = workspace.areas.find((item) => item.id === area.id);
        const localCards = new Map(previous?.cards.map((card) => [card.id, card]));
        return {
          ...area,
          ...(previous?.sourceId ? { sourceId: previous.sourceId } : {}),
          cards: area.cards.map((card) => {
            const prior = localCards.get(card.id);
            return prior ? { ...card, sourceId: prior.sourceId, schedule: prior.schedule } : card;
          }),
        };
      }),
    ),
  );
}
export function hashesFrom(snapshot: Snapshot): Readonly<Record<string, string>> {
  return Object.fromEntries(snapshot.areas.map((area) => [area.document.id, area.contentHash]));
}
export function conflictResult(
  input: WorkspaceSyncInput,
  workspace: Workspace,
  snapshot: Snapshot,
) {
  return Effect.gen(function* () {
    const areas = yield* snapshotAreas(snapshot, input, workspace);
    const preview = {
      ownerId: snapshot.ownerId,
      areas,
      hashes: hashesFrom(snapshot),
      deletedAreaIds: snapshot.deletedAreaIds,
    };
    const rebuilt = yield* applyWorkspaceContentConflict(workspace, preview);
    return { _tag: "ContentConflict", workspace: rebuilt, ...preview } as const;
  });
}
export function stableContent(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableContent).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableContent(item)}`)
      .join(",")}}`;
  return value === undefined ? "null" : JSON.stringify(value);
}
