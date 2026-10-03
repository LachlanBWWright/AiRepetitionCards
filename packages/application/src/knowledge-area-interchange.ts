import { Effect, Schema } from "effect";
import type {
  KnowledgeArea,
  KnowledgeAreaDecodeError,
  LearningArea,
  StudyCard,
} from "@recall/domain";
import { KnowledgeAreaSchema } from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { stableSyncId } from "@recall/sync-core";

const defaultPolicy = {
  tutorInstructions: "",
  quizInstructions: null,
  cardGenerationInstructions: null,
} as const;

function objectiveId(title: string, index: number): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `objective-${slug || "learning"}-${index + 1}`;
}

export type KnowledgeAreaExportError = {
  readonly _tag: "KnowledgeAreaExportError";
  readonly reason: "invalid-area" | "media-requires-package";
};

export function toKnowledgeArea(
  area: LearningArea,
  syncIds = false,
  includeMedia = false,
): Effect.Effect<KnowledgeArea, KnowledgeAreaExportError> {
  if (!includeMedia && area.cards.some((card) => (card.media?.length ?? 0) > 0)) {
    return Effect.fail({ _tag: "KnowledgeAreaExportError", reason: "media-requires-package" });
  }
  const objectives: NonNullable<LearningArea["objectives"]> =
    area.objectives ??
    Array.from(new Set(area.cards.map((card) => card.objective))).map((title, index) => ({
      id: syncIds
        ? stableSyncId(`objective:${area.sourceId ?? area.id}:${title}`)
        : objectiveId(title, index),
      title,
      description: null,
      prerequisiteIds: [],
    }));
  const documentIdByLocalId = new Map(
    objectives.map((objective) => [
      objective.id,
      syncIds ? objective.id : (objective.sourceId ?? objective.id),
    ]),
  );
  const documentObjectives = objectives.map((objective) => ({
    ...objective,
    id: documentIdByLocalId.get(objective.id) ?? objective.id,
    prerequisiteIds: objective.prerequisiteIds.map((id) => documentIdByLocalId.get(id) ?? id),
  }));
  const idsByTitle = new Map(objectives.map((objective) => [objective.title, objective.id]));

  const document = {
    schemaVersion: "1.0.0",
    id: syncIds ? area.id : (area.sourceId ?? area.id),
    title: area.title,
    description: area.description ?? null,
    language: area.language ?? "en",
    objectives: documentObjectives,
    ai: area.ai ?? defaultPolicy,
    cards: area.cards.map((card) => ({
      kind: "basic",
      id: syncIds ? card.id : (card.sourceId ?? card.id),
      front: card.front,
      back: card.back,
      ...(card.media ? { media: card.media } : {}),
      objectiveIds: (
        card.objectiveIds ?? [
          idsByTitle.get(card.objective) ?? objectives[0]?.id ?? objectiveId(card.objective, 0),
        ]
      ).map((id) => documentIdByLocalId.get(id) ?? id),
      tags: card.tags ?? [],
      origin: card.origin ?? "authored",
    })),
    tags: area.tags ?? [],
    licence: area.licence ?? null,
    ...(area.attribution !== undefined ? { attribution: area.attribution } : {}),
    ...(area.forkedFromVersionId ? { forkedFromVersionId: area.forkedFromVersionId } : {}),
  };
  return Schema.decodeUnknown(KnowledgeAreaSchema)(document).pipe(
    Effect.mapError((): KnowledgeAreaExportError => ({
      _tag: "KnowledgeAreaExportError",
      reason: "invalid-area",
    })),
  );
}

export type KnowledgeAreaImportError =
  | KnowledgeAreaDecodeError
  | {
      readonly _tag: "KnowledgeAreaImportError";
      readonly reason: "unsupported-card-type" | "media-requires-package";
    };

export function fromKnowledgeArea(
  document: KnowledgeArea,
  color: string,
  preserveIds: boolean,
  createId: () => string,
  mediaAvailable = false,
): Effect.Effect<LearningArea, KnowledgeAreaImportError> {
  if (!mediaAvailable && document.cards.some((card) => (card.media?.length ?? 0) > 0)) {
    return Effect.fail({ _tag: "KnowledgeAreaImportError", reason: "media-requires-package" });
  }
  if (document.cards.some((card) => card.kind === "cloze")) {
    return Effect.fail({ _tag: "KnowledgeAreaImportError", reason: "unsupported-card-type" });
  }
  const titleById = new Map(
    document.objectives.map((objective) => [objective.id, objective.title]),
  );
  const localObjectiveIdByDocumentId = new Map(
    document.objectives.map((objective) => [objective.id, preserveIds ? objective.id : createId()]),
  );
  const objectives = document.objectives.map((objective) => ({
    ...objective,
    id: localObjectiveIdByDocumentId.get(objective.id) ?? objective.id,
    ...(preserveIds ? {} : { sourceId: objective.id }),
    prerequisiteIds: objective.prerequisiteIds.map(
      (id) => localObjectiveIdByDocumentId.get(id) ?? id,
    ),
  }));
  const cards: StudyCard[] = document.cards.flatMap((card) => {
    if (card.kind !== "basic") return [];
    return [
      {
        id: preserveIds ? card.id : createId(),
        ...(preserveIds ? {} : { sourceId: card.id }),
        front: card.front,
        back: card.back,
        ...(card.media ? { media: card.media } : {}),
        objective:
          card.objectiveIds.map((id) => titleById.get(id) ?? "Learning objective").join(" · ") ||
          "Learning objective",
        objectiveIds: card.objectiveIds.map((id) => localObjectiveIdByDocumentId.get(id) ?? id),
        tags: card.tags,
        origin: "imported",
        schedule: newSchedule(),
      },
    ];
  });
  return Effect.succeed({
    id: preserveIds ? document.id : createId(),
    ...(preserveIds ? {} : { sourceId: document.id }),
    title: document.title,
    color,
    cards,
    objectives,
    description: document.description,
    language: document.language,
    ai: document.ai,
    tags: document.tags,
    licence: document.licence,
    ...(document.attribution !== undefined ? { attribution: document.attribution } : {}),
    ...(document.forkedFromVersionId ? { forkedFromVersionId: document.forkedFromVersionId } : {}),
  });
}
