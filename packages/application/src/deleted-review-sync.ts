import { Effect } from "effect";
import type {
  WorkspaceSnapshotSchema,
  WorkspaceReviewIdentitiesResponseSchema,
} from "@recall/contracts";
import type { AreaId, CardId, LearningArea, ReviewEvent, Workspace } from "@recall/domain";
import { toKnowledgeArea } from "./knowledge-area-interchange";
import { retainedReviewContent } from "./review-deletion-retention";
import type { WorkspaceSyncFailure } from "./workspace-sync";

type Snapshot = typeof WorkspaceSnapshotSchema.Type;
type Identities = typeof WorkspaceReviewIdentitiesResponseSchema.Type;
const failure = (reason: WorkspaceSyncFailure["reason"]): WorkspaceSyncFailure => ({
  _tag: "WorkspaceSyncFailure",
  reason,
});

/** Provision only identities absent on the server. Existing tombstoned identities stay deleted. */
export function prepareDeletedReviewProvisions(
  workspace: Workspace,
  batch: readonly ReviewEvent[],
  identities: Identities["reviewCards"],
  snapshot: Snapshot,
  safeDeletedCardIds: ReadonlySet<CardId>,
) {
  return Effect.gen(function* () {
    const known = new Map(identities.map((card) => [card.id, card]));
    const archived = new Map(retainedReviewContent(workspace).map((area) => [area.id, area]));
    const missing = new Map<AreaId, Set<CardId>>();
    for (const event of batch) {
      const remote = known.get(event.cardId);
      if (remote) {
        if (remote.areaId !== event.areaId) return yield* Effect.fail(failure("content"));
        continue;
      }
      const live = workspace.areas.find((area) => area.id === event.areaId);
      if (live?.cards.some((card) => card.id === event.cardId)) continue;
      if (
        !archived.get(event.areaId)?.cards.some((card) => card.id === event.cardId) ||
        snapshot.deletedAreaIds.includes(event.areaId)
      )
        return yield* Effect.fail(failure("deleted-review-content-missing"));
      const cards = missing.get(event.areaId) ?? new Set<CardId>();
      cards.add(event.cardId);
      missing.set(event.areaId, cards);
    }
    // A staged area defers its ordinary live upload. Include the missing live identities
    // used by this same review batch so every submitted operation has a server card.
    for (const event of batch) {
      const cards = missing.get(event.areaId);
      if (!cards || known.has(event.cardId)) continue;
      const live = workspace.areas.find((area) => area.id === event.areaId);
      if (live?.cards.some((card) => card.id === event.cardId)) cards.add(event.cardId);
    }
    return yield* Effect.forEach([...missing], ([areaId, cardIds]) =>
      Effect.gen(function* () {
        const retained = archived.get(areaId);
        if (!retained) return yield* Effect.fail(failure("deleted-review-content-missing"));
        const live = workspace.areas.find((area) => area.id === areaId);
        const sourceCards = [...retained.cards, ...(live?.cards ?? [])].filter((card) =>
          cardIds.has(card.id),
        );
        if (sourceCards.length !== cardIds.size)
          return yield* Effect.fail(failure("deleted-review-content-missing"));
        const objectives = new Map(
          [...(retained.objectives ?? []), ...(live?.objectives ?? [])].map((objective) => [
            objective.id,
            objective,
          ]),
        );
        const required = new Set(sourceCards.flatMap((card) => card.objectiveIds ?? []));
        for (const objective of objectives.values())
          if (sourceCards.some((card) => !card.objectiveIds && card.objective === objective.title))
            required.add(objective.id);
        const visit = [...required];
        for (let index = 0; index < visit.length; index += 1) {
          const id = visit[index];
          if (id === undefined) continue;
          for (const prerequisite of objectives.get(id)?.prerequisiteIds ?? []) {
            if (!required.has(prerequisite)) {
              required.add(prerequisite);
              visit.push(prerequisite);
            }
          }
        }
        const minimal: LearningArea = {
          ...retained,
          ...(live ?? {}),
          cards: sourceCards,
          ...(objectives.size > 0
            ? {
                objectives: [...objectives.values()].filter((objective) =>
                  required.has(objective.id),
                ),
              }
            : {}),
        };
        const document = yield* toKnowledgeArea(minimal, true, true).pipe(
          Effect.mapError(() => failure("deleted-review-provision-capacity")),
        );
        const remote = snapshot.areas.find((area) => area.document.id === areaId);
        if (remote?.document.cards.some((card) => cardIds.has(card.id)))
          return yield* Effect.fail(failure("reviews"));
        const cards = [
          ...(remote?.document.cards ?? []).filter((card) => !safeDeletedCardIds.has(card.id)),
          ...document.cards,
        ];
        const mergedObjectives = new Map(
          [...document.objectives, ...(remote?.document.objectives ?? [])].map((objective) => [
            objective.id,
            objective,
          ]),
        );
        if (cards.length > 500 || mergedObjectives.size > 200)
          return yield* Effect.fail(failure("deleted-review-provision-capacity"));
        return {
          document: {
            ...(remote?.document ?? document),
            cards,
            objectives: [...mergedObjectives.values()],
          },
          color: remote?.color ?? retained.color,
          baseContentHash: remote
            ? (workspace.syncContentHashes?.[areaId] ?? remote.contentHash)
            : null,
        };
      }),
    );
  });
}
