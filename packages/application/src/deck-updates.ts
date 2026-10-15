import { Effect, Either, Schema } from "effect";
import {
  KnowledgeAreaSchema,
  type ActivityJson,
  type KnowledgeArea,
  type LearningActivity,
} from "@recall/domain";

export type DeckUpdateFailure =
  | {
      readonly _tag: "DeckUpdateFailure";
      readonly reason: "invalid-input" | "lineage-mismatch" | "missing-new-id";
      readonly sourceId?: string;
    }
  | {
      readonly _tag: "DeckUpdateFailure";
      readonly reason: "local-conflict";
      readonly sourceIds: readonly string[];
    };
export type DeckUpdateInput = {
  readonly baseline: unknown;
  readonly current: unknown;
  readonly upstream: unknown;
  readonly selectedSourceIds: readonly string[];
  readonly confirmedConflictSourceIds?: readonly string[];
  readonly newIds?: Readonly<Record<string, string>>;
};
export type DeckUpdateResult = {
  readonly area: KnowledgeArea;
  readonly locallyModifiedSourceIds: readonly string[];
};

const identity = (value: { readonly sourceId?: string | undefined; readonly id: string }) =>
  value.sourceId ?? value.id;
const content = (value: object) => {
  const rest = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "id" && key !== "sourceId"),
  );
  return JSON.stringify(rest);
};

const UpdateCommandSchema = Schema.Struct({
  baseline: KnowledgeAreaSchema,
  current: KnowledgeAreaSchema,
  upstream: KnowledgeAreaSchema,
  selectedSourceIds: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  confirmedConflictSourceIds: Schema.optional(
    Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  ),
  newIds: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String.pipe(Schema.minLength(1)) }),
  ),
});

const objectiveRef = (objectives: KnowledgeArea["objectives"], id: string) => {
  const objective = objectives.find((item) => item.id === id);
  return objective ? identity(objective) : id;
};
const cardRef = (cards: KnowledgeArea["cards"], id: string) => {
  const card = cards.find((item) => item.id === id);
  return card ? identity(card) : id;
};
const stableBuiltinPayload = (value: ActivityJson, cards: KnowledgeArea["cards"]): ActivityJson => {
  if (Array.isArray(value))
    return (value as readonly ActivityJson[]).map((item: ActivityJson) =>
      stableBuiltinPayload(item, cards),
    );
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, ActivityJson>>).map(
      ([key, entry]): [string, ActivityJson] => {
        if (key === "cardId" && typeof entry === "string") return [key, cardRef(cards, entry)];
        if (key === "cardIds" && Array.isArray(entry))
          return [
            key,
            entry.map((id: ActivityJson) => (typeof id === "string" ? cardRef(cards, id) : id)),
          ];
        return [key, stableBuiltinPayload(entry, cards)];
      },
    ),
  );
};
const remapBuiltinPayload = (
  value: ActivityJson,
  cardIdentityById: ReadonlyMap<string, string>,
  updatedCardIdByIdentity: ReadonlyMap<string, string>,
): ActivityJson => {
  if (Array.isArray(value))
    return (value as readonly ActivityJson[]).map((item: ActivityJson) =>
      remapBuiltinPayload(item, cardIdentityById, updatedCardIdByIdentity),
    );
  if (value === null || typeof value !== "object") return value;
  const cardRef = (id: string): string => {
    const identity = cardIdentityById.get(id) ?? id;
    return updatedCardIdByIdentity.get(identity) ?? id;
  };
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, ActivityJson>>).map(
      ([key, entry]): [string, ActivityJson] => {
        if (key === "cardId" && typeof entry === "string") return [key, cardRef(entry)];
        if (key === "cardIds" && Array.isArray(entry))
          return [
            key,
            (entry as readonly ActivityJson[]).map((id: ActivityJson) =>
              typeof id === "string" ? cardRef(id) : id,
            ),
          ];
        return [key, remapBuiltinPayload(entry, cardIdentityById, updatedCardIdByIdentity)];
      },
    ),
  );
};
const objectiveContent = (
  item: KnowledgeArea["objectives"][number],
  objectives: KnowledgeArea["objectives"],
) =>
  JSON.stringify({
    ...item,
    id: undefined,
    sourceId: undefined,
    prerequisiteIds: item.prerequisiteIds.map((id) => objectiveRef(objectives, id)).sort(),
  });
const cardContent = (
  item: KnowledgeArea["cards"][number],
  objectives: KnowledgeArea["objectives"],
) =>
  JSON.stringify({
    ...item,
    id: undefined,
    sourceId: undefined,
    objectiveIds: item.objectiveIds.map((id) => objectiveRef(objectives, id)).sort(),
  });
const activityContent = (
  item: LearningActivity,
  objectives: KnowledgeArea["objectives"],
  cards: KnowledgeArea["cards"],
) =>
  JSON.stringify({
    ...item,
    id: undefined,
    sourceId: undefined,
    areaId: undefined,
    objectiveIds: item.objectiveIds.map((id) => objectiveRef(objectives, id)).sort(),
    ...(item.pluginId.startsWith("recall.")
      ? { payload: stableBuiltinPayload(item.payload, cards) }
      : {}),
  });

/** Applies only explicitly selected source entities and reports local edits that would be replaced. */
export function applySelectedDeckUpdate(
  input: unknown,
): Effect.Effect<DeckUpdateResult, DeckUpdateFailure> {
  const parsed = Schema.decodeUnknownEither(UpdateCommandSchema)(input);
  if (Either.isLeft(parsed)) {
    return Effect.fail({ _tag: "DeckUpdateFailure", reason: "invalid-input" });
  }
  const { baseline: base, current: local, upstream: remote } = parsed.right;
  if (remote.id !== base.id)
    return Effect.fail({ _tag: "DeckUpdateFailure", reason: "lineage-mismatch" });
  if (local.id === base.id || local.sourceId !== base.id)
    return Effect.fail({ _tag: "DeckUpdateFailure", reason: "lineage-mismatch" });
  if (
    new Set(parsed.right.selectedSourceIds).size !== parsed.right.selectedSourceIds.length ||
    new Set(parsed.right.confirmedConflictSourceIds ?? []).size !==
      (parsed.right.confirmedConflictSourceIds ?? []).length
  )
    return Effect.fail({ _tag: "DeckUpdateFailure", reason: "invalid-input" });
  const selected = new Set(parsed.right.selectedSourceIds);
  const confirmed = new Set(parsed.right.confirmedConflictSourceIds ?? []);
  const knownSourceIds = new Set(
    [
      ...base.objectives,
      ...base.cards,
      ...(base.activities ?? []),
      ...local.objectives,
      ...local.cards,
      ...(local.activities ?? []),
      ...remote.objectives,
      ...remote.cards,
      ...(remote.activities ?? []),
    ].map(identity),
  );
  if (
    [...selected, ...confirmed].some((id) => !knownSourceIds.has(id)) ||
    [...confirmed].some((id) => !selected.has(id))
  )
    return Effect.fail({ _tag: "DeckUpdateFailure", reason: "invalid-input" });
  const modified = new Set<string>();
  let missingNewId: string | undefined;
  const merge = <A extends { readonly id: string; readonly sourceId?: string | undefined }>(
    before: readonly A[],
    now: readonly A[],
    next: readonly A[],
    reviseReplacement?: (current: A, replacement: A) => A,
  ): A[] => {
    const b = new Map(before.map((item) => [identity(item), item]));
    const c = new Map(now.map((item) => [identity(item), item]));
    const n = new Map(next.map((item) => [identity(item), item]));
    const result: A[] = [];
    for (const [key, item] of c) {
      const original = b.get(key);
      if (original) {
        const currentContent =
          before === base.objectives
            ? objectiveContent(item as KnowledgeArea["objectives"][number], local.objectives)
            : before === base.cards
              ? cardContent(item as KnowledgeArea["cards"][number], local.objectives)
              : before === base.activities
                ? activityContent(
                    item as NonNullable<KnowledgeArea["activities"]>[number],
                    local.objectives,
                    local.cards,
                  )
                : content(item);
        const baselineContent =
          before === base.objectives
            ? objectiveContent(original as KnowledgeArea["objectives"][number], base.objectives)
            : before === base.cards
              ? cardContent(original as KnowledgeArea["cards"][number], base.objectives)
              : before === base.activities
                ? activityContent(
                    original as NonNullable<KnowledgeArea["activities"]>[number],
                    base.objectives,
                    base.cards,
                  )
                : content(original);
        if (currentContent !== baselineContent) modified.add(key);
      }
      if (!selected.has(key)) {
        result.push(item);
        continue;
      }
      const replacement = n.get(key);
      if (replacement && reviseReplacement) result.push(reviseReplacement(item, replacement));
      else if (replacement)
        result.push({
          ...replacement,
          id: item.id,
          sourceId: item.sourceId ?? replacement.sourceId,
        });
    }
    for (const [key, item] of n)
      if (!c.has(key) && selected.has(key)) {
        const id = parsed.right.newIds?.[key];
        if (!id) {
          missingNewId = key;
          continue;
        }
        result.push({ ...item, id, sourceId: key });
      }
    return result;
  };
  let objectives = merge(base.objectives, local.objectives, remote.objectives);
  const cards = merge(base.cards, local.cards, remote.cards);
  const activities = merge<NonNullable<KnowledgeArea["activities"]>[number]>(
    base.activities ?? [],
    local.activities ?? [],
    remote.activities ?? [],
    (currentActivity, nextActivity) => {
      const changed =
        activityContent(currentActivity, local.objectives, local.cards) !==
        activityContent(nextActivity, remote.objectives, remote.cards);
      return {
        ...nextActivity,
        id: currentActivity.id,
        sourceId: currentActivity.sourceId ?? nextActivity.sourceId,
        revision: Math.max(nextActivity.revision, currentActivity.revision + (changed ? 1 : 0)),
      };
    },
  );
  if (missingNewId)
    return Effect.fail({
      _tag: "DeckUpdateFailure",
      reason: "missing-new-id",
      sourceId: missingNewId,
    });
  const unconfirmed = [...modified].filter((id) => selected.has(id) && !confirmed.has(id)).sort();
  if (unconfirmed.length > 0)
    return Effect.fail({
      _tag: "DeckUpdateFailure",
      reason: "local-conflict",
      sourceIds: unconfirmed,
    });
  const objectiveIdByIdentity = new Map(objectives.map((item) => [identity(item), item.id]));
  objectives = objectives.map((objective) => ({
    ...objective,
    prerequisiteIds: objective.prerequisiteIds.map((id) => {
      const upstreamObjective = remote.objectives.find((item) => item.id === id);
      return upstreamObjective
        ? (objectiveIdByIdentity.get(identity(upstreamObjective)) ?? id)
        : id;
    }),
  }));
  const updatedCards = cards.map((card) => ({
    ...card,
    objectiveIds: card.objectiveIds.map((id) => {
      const upstreamObjective = remote.objectives.find((item) => item.id === id);
      return upstreamObjective
        ? (objectiveIdByIdentity.get(identity(upstreamObjective)) ?? id)
        : id;
    }),
  }));
  const cardIdentityById = new Map(
    [...remote.cards, ...local.cards].map((card) => [card.id, identity(card)]),
  );
  const updatedCardIdByIdentity = new Map(updatedCards.map((card) => [identity(card), card.id]));
  const updatedActivities = activities.map((activity) => ({
    ...activity,
    areaId: local.id,
    objectiveIds: activity.objectiveIds.map((id) => {
      const upstreamObjective = remote.objectives.find((item) => item.id === id);
      return upstreamObjective
        ? (objectiveIdByIdentity.get(identity(upstreamObjective)) ?? id)
        : id;
    }),
    ...(activity.pluginId.startsWith("recall.")
      ? {
          payload: remapBuiltinPayload(activity.payload, cardIdentityById, updatedCardIdByIdentity),
        }
      : {}),
  }));
  const allEntityIds = [
    ...objectives.map((item) => item.id),
    ...updatedCards.map((item) => item.id),
    ...updatedActivities.map((item) => item.id),
  ];
  const objectiveIds = new Set(objectives.map((item) => item.id));
  if (
    new Set(allEntityIds).size !== allEntityIds.length ||
    objectives.some((item) => item.prerequisiteIds.some((id) => !objectiveIds.has(id))) ||
    updatedCards.some((item) => item.objectiveIds.some((id) => !objectiveIds.has(id)))
  )
    return Effect.fail({ _tag: "DeckUpdateFailure", reason: "lineage-mismatch" });
  const newSourceIds = [
    ...remote.objectives.map(identity),
    ...remote.cards.map(identity),
    ...(remote.activities ?? []).map(identity),
  ].filter(
    (key) =>
      selected.has(key) &&
      ![...local.objectives, ...local.cards, ...(local.activities ?? [])].some(
        (item) => identity(item) === key,
      ),
  );
  const reservedIds = new Set<string>([
    ...local.objectives.map((item) => item.id),
    ...local.cards.map((item) => item.id),
    ...(local.activities ?? []).map((item) => item.id),
    ...base.objectives.map((item) => item.id),
    ...base.cards.map((item) => item.id),
    ...remote.objectives.map((item) => item.id),
    ...remote.cards.map((item) => item.id),
    ...(remote.activities ?? []).map((item) => item.id),
  ]);
  const generatedIds = newSourceIds
    .map((key) => parsed.right.newIds?.[key])
    .filter((id): id is string => id !== undefined);
  if (
    new Set(generatedIds).size !== generatedIds.length ||
    generatedIds.some((id) => reservedIds.has(id))
  )
    return Effect.fail({ _tag: "DeckUpdateFailure", reason: "invalid-input" });
  const decoded = Schema.decodeUnknownEither(KnowledgeAreaSchema)({
    ...local,
    objectives,
    cards: updatedCards,
    ...(remote.activities === undefined && local.activities === undefined
      ? {}
      : { activities: updatedActivities }),
  });
  return Either.isLeft(decoded)
    ? Effect.fail({ _tag: "DeckUpdateFailure", reason: "invalid-input" })
    : Effect.succeed({ area: decoded.right, locallyModifiedSourceIds: [...modified].sort() });
}
