import { Effect, Either, Schema } from "effect";
import { KnowledgeAreaSchema, type KnowledgeArea } from "@recall/domain";
import { stableSyncId } from "@recall/sync-core";
import { expandCloze } from "./cloze";

export type KnowledgeAreaDiffFailure =
  | { readonly _tag: "KnowledgeAreaDiffInvalidInput"; readonly side: "baseline" | "candidate" }
  | {
      readonly _tag: "KnowledgeAreaDiffAreaMismatch";
      readonly baselineId: string;
      readonly candidateId: string;
    }
  | {
      readonly _tag: "KnowledgeAreaDiffDuplicateId";
      readonly side: "baseline" | "candidate";
      readonly entity: "objective" | "card";
      readonly id: string;
    }
  | { readonly _tag: "KnowledgeAreaDiffInvalidCloze"; readonly side: "baseline" | "candidate" };

export type KnowledgeAreaMetadataField =
  "title" | "description" | "language" | "ai" | "tags" | "licence" | "attribution";

export type KnowledgeAreaMetadataChange = {
  readonly field: KnowledgeAreaMetadataField;
  readonly before: KnowledgeArea[KnowledgeAreaMetadataField] | undefined;
  readonly after: KnowledgeArea[KnowledgeAreaMetadataField] | undefined;
};

export type KnowledgeAreaEntityChanges<A> = {
  readonly added: readonly A[];
  readonly changed: readonly { readonly before: A; readonly after: A }[];
  readonly removed: readonly A[];
};

export type KnowledgeAreaDiff = {
  readonly areaId: string;
  readonly metadata: readonly KnowledgeAreaMetadataChange[];
  readonly objectives: KnowledgeAreaEntityChanges<KnowledgeArea["objectives"][number]>;
  readonly cards: KnowledgeAreaEntityChanges<KnowledgeArea["cards"][number]>;
};

const metadataFields: readonly KnowledgeAreaMetadataField[] = [
  "title",
  "description",
  "language",
  "ai",
  "tags",
  "licence",
  "attribution",
];

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

type StableEntity = {
  readonly id: string;
  readonly sourceId?: string | undefined;
  readonly [field: string]: unknown;
};

const stableEntityId = (item: StableEntity): string => item.sourceId ?? item.id;

const stableEntityContent = (
  item: StableEntity,
  stableObjectiveIds: ReadonlyMap<string, string>,
): string => {
  const content = Object.fromEntries(
    Object.entries(item)
      .filter(
        ([key]) =>
          key !== "id" &&
          key !== "sourceId" &&
          key !== "origin" &&
          key !== "forkedFromVersionId" &&
          key !== "deletionIndex",
      )
      .map(([key, value]) => [
        key,
        (key === "objectiveIds" || key === "prerequisiteIds") && Array.isArray(value)
          ? value.map((id: unknown) =>
              typeof id === "string" ? (stableObjectiveIds.get(id) ?? id) : id,
            )
          : value,
      ]),
  );
  return stableJson(content);
};

const changesById = <A extends StableEntity>(
  before: readonly A[],
  after: readonly A[],
  stableObjectiveIdsBefore: ReadonlyMap<string, string>,
  stableObjectiveIdsAfter: ReadonlyMap<string, string>,
): KnowledgeAreaEntityChanges<A> => {
  const beforeById = new Map(before.map((item) => [stableEntityId(item), item]));
  const afterById = new Map(after.map((item) => [stableEntityId(item), item]));
  const added = after.filter((item) => !beforeById.has(stableEntityId(item)));
  const removed = before.filter((item) => !afterById.has(stableEntityId(item)));
  const changed = after.flatMap((item) => {
    const previous = beforeById.get(stableEntityId(item));
    return previous !== undefined &&
      stableEntityContent(previous, stableObjectiveIdsBefore) !==
        stableEntityContent(item, stableObjectiveIdsAfter)
      ? [{ before: previous, after: item }]
      : [];
  });
  return { added, changed, removed };
};

type PortableCard = KnowledgeArea["cards"][number];
type CanonicalCard = {
  readonly key: string;
  readonly card: PortableCard;
  readonly content: string;
};

const canonicalCards = (
  cards: readonly PortableCard[],
  stableObjectiveIds: ReadonlyMap<string, string>,
  side: "baseline" | "candidate",
): Effect.Effect<readonly CanonicalCard[], KnowledgeAreaDiffFailure> =>
  Effect.gen(function* () {
    const result: CanonicalCard[] = [];
    for (const card of cards) {
      if (card.kind === "basic") {
        result.push({
          key: stableEntityId(card),
          card,
          content: stableEntityContent(card, stableObjectiveIds),
        });
        continue;
      }
      const rendered = yield* expandCloze(card.text, card.deletionIndex).pipe(
        Effect.mapError(() => ({ _tag: "KnowledgeAreaDiffInvalidCloze", side }) as const),
      );
      for (const variant of rendered) {
        const sourceCardId = card.sourceId ?? card.id;
        const key =
          card.deletionIndex !== undefined && card.sourceId !== undefined
            ? card.sourceId
            : stableSyncId(`cloze:${sourceCardId}:${String(variant.deletionIndex)}`);
        const content = stableEntityContent(
          {
            ...card,
            text: variant.text,
          },
          stableObjectiveIds,
        );
        result.push({ key, card, content });
      }
    }
    return result;
  });

const changesByCanonicalCard = (
  before: readonly CanonicalCard[],
  after: readonly CanonicalCard[],
): KnowledgeAreaEntityChanges<PortableCard> => {
  const beforeById = new Map(before.map((item) => [item.key, item]));
  const afterById = new Map(after.map((item) => [item.key, item]));
  const added = after.filter((item) => !beforeById.has(item.key)).map((item) => item.card);
  const removed = before.filter((item) => !afterById.has(item.key)).map((item) => item.card);
  const changed = after.flatMap((item) => {
    const previous = beforeById.get(item.key);
    return previous !== undefined && previous.content !== item.content
      ? [{ before: previous.card, after: item.card }]
      : [];
  });
  return { added, changed, removed };
};

const duplicateFailure = (
  values: readonly StableEntity[],
  side: "baseline" | "candidate",
  entity: "objective" | "card",
): KnowledgeAreaDiffFailure | undefined => {
  const seen = new Set<string>();
  for (const value of values) {
    const id = stableEntityId(value);
    if (seen.has(id)) return { _tag: "KnowledgeAreaDiffDuplicateId", side, entity, id };
    seen.add(id);
  }
  return undefined;
};

const decode = (input: unknown, side: "baseline" | "candidate") => {
  const result = Schema.decodeUnknownEither(KnowledgeAreaSchema)(input);
  return Either.isLeft(result)
    ? Effect.fail({ _tag: "KnowledgeAreaDiffInvalidInput", side } as const)
    : Effect.succeed(result.right);
};

/** Compare portable content by stable IDs; learner schedules and review history are not part of this model. */
export const diffKnowledgeAreas = (input: {
  readonly baseline: unknown;
  readonly candidate: unknown;
}): Effect.Effect<KnowledgeAreaDiff, KnowledgeAreaDiffFailure> =>
  Effect.gen(function* () {
    const baseline = yield* decode(input.baseline, "baseline");
    const candidate = yield* decode(input.candidate, "candidate");
    const baselineAreaId = baseline.sourceId ?? baseline.id;
    const candidateAreaId = candidate.sourceId ?? candidate.id;
    if (baselineAreaId !== candidateAreaId) {
      return yield* Effect.fail({
        _tag: "KnowledgeAreaDiffAreaMismatch",
        baselineId: baselineAreaId,
        candidateId: candidateAreaId,
      } as const);
    }

    for (const side of ["baseline", "candidate"] as const) {
      const area = side === "baseline" ? baseline : candidate;
      const objectiveFailure = duplicateFailure(area.objectives, side, "objective");
      if (objectiveFailure) return yield* Effect.fail(objectiveFailure);
      const cardFailure = duplicateFailure(area.cards, side, "card");
      if (cardFailure) return yield* Effect.fail(cardFailure);
    }

    const stableObjectiveIds = (area: KnowledgeArea): ReadonlyMap<string, string> =>
      new Map(area.objectives.map((objective) => [objective.id, stableEntityId(objective)]));
    const baselineObjectiveIds = stableObjectiveIds(baseline);
    const candidateObjectiveIds = stableObjectiveIds(candidate);
    const baselineCards = yield* canonicalCards(baseline.cards, baselineObjectiveIds, "baseline");
    const candidateCards = yield* canonicalCards(
      candidate.cards,
      candidateObjectiveIds,
      "candidate",
    );

    const metadata = metadataFields.flatMap((field) => {
      const before = baseline[field];
      const after = candidate[field];
      return stableJson(before) === stableJson(after) ? [] : [{ field, before, after }];
    });

    return {
      areaId: baseline.id,
      metadata,
      objectives: changesById(
        baseline.objectives,
        candidate.objectives,
        baselineObjectiveIds,
        candidateObjectiveIds,
      ),
      cards: changesByCanonicalCard(baselineCards, candidateCards),
    };
  });
