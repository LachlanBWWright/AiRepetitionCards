import { Effect, Schema } from "effect";
import type {
  KnowledgeArea,
  KnowledgeAreaDecodeError,
  LearningArea,
  Assessment,
} from "@recall/domain";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  KnowledgeAreaSchema,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { stableSyncId } from "@recall/sync-core";
import { expandCloze, renderClozeCard, type ClozeFailure } from "./cloze";

const defaultPolicy = {
  tutorInstructions: "",
  quizInstructions: null,
  cardGenerationInstructions: null,
} as const;

function objectiveId(title: string, index: number): ReturnType<typeof createObjectiveId> {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return createObjectiveId(`objective-${slug || "learning"}-${String(index + 1)}`);
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
        ? createObjectiveId(stableSyncId(`objective:${area.sourceId ?? area.id}:${title}`))
        : objectiveId(title, index),
      title,
      description: null,
      prerequisiteIds: [],
    }));
  const documentIdByLocalId = new Map(
    objectives.map((objective) => [
      objective.id,
      syncIds ? objective.id : createObjectiveId(objective.sourceId ?? objective.id),
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
    ...(area.sourceId ? { sourceId: area.sourceId } : {}),
    title: area.title,
    description: area.description ?? null,
    language: area.language ?? "en",
    objectives: documentObjectives,
    ai: area.ai ?? defaultPolicy,
    cards: area.cards.map((card) => ({
      ...(card.cloze
        ? { kind: "cloze", text: card.cloze.text, deletionIndex: card.cloze.deletionIndex }
        : { kind: "basic", front: card.front, back: card.back }),
      id: syncIds ? card.id : (card.sourceId ?? card.id),
      ...(card.sourceId ? { sourceId: card.sourceId } : {}),
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
  return Effect.gen(function* () {
    for (const card of area.cards) {
      if (!card.cloze) continue;
      const rendered = yield* renderClozeCard(card.cloze.text, card.cloze.deletionIndex).pipe(
        Effect.mapError((): KnowledgeAreaExportError => ({
          _tag: "KnowledgeAreaExportError",
          reason: "invalid-area",
        })),
      );
      if (rendered.front !== card.front || rendered.back !== card.back) {
        return yield* Effect.fail({
          _tag: "KnowledgeAreaExportError",
          reason: "invalid-area",
        } as const);
      }
    }
    return yield* Schema.decodeUnknown(KnowledgeAreaSchema)(document).pipe(
      Effect.mapError((): KnowledgeAreaExportError => ({
        _tag: "KnowledgeAreaExportError",
        reason: "invalid-area",
      })),
    );
  });
}

export type KnowledgeAreaImportError =
  | KnowledgeAreaDecodeError
  | ClozeFailure
  | {
      readonly _tag: "KnowledgeAreaImportError";
      readonly reason:
        "unsupported-card-type" | "media-requires-package" | "limits-exceeded" | "invalid-document";
    };

export function fromKnowledgeArea(
  document: KnowledgeArea,
  color: string,
  preserveIds: boolean,
  createId: () => string,
  now: Date,
  mediaAvailable = false,
): Effect.Effect<LearningArea, KnowledgeAreaImportError> {
  if (!Number.isFinite(now.getTime())) {
    return Effect.fail({ _tag: "KnowledgeAreaImportError", reason: "invalid-document" });
  }
  if (!mediaAvailable && document.cards.some((card) => (card.media?.length ?? 0) > 0)) {
    return Effect.fail({ _tag: "KnowledgeAreaImportError", reason: "media-requires-package" });
  }
  const titleById = new Map(
    document.objectives.map((objective) => [objective.id, objective.title]),
  );
  const localObjectiveIdByDocumentId = new Map(
    document.objectives.map((objective) => [
      objective.id,
      preserveIds ? objective.id : createObjectiveId(createId()),
    ]),
  );
  const objectives = document.objectives.map((objective) => ({
    ...objective,
    id: localObjectiveIdByDocumentId.get(objective.id) ?? objective.id,
    ...(preserveIds
      ? objective.sourceId
        ? { sourceId: objective.sourceId }
        : {}
      : { sourceId: objective.sourceId ?? objective.id }),
    prerequisiteIds: objective.prerequisiteIds.map(
      (id) => localObjectiveIdByDocumentId.get(id) ?? id,
    ),
  }));
  return Effect.gen(function* () {
    const cards: Assessment[] = [];
    const outputIds = new Set<string>();
    for (const card of document.cards) {
      const content =
        card.kind === "basic"
          ? [{ front: card.front, back: card.back }]
          : yield* expandCloze(card.text, card.deletionIndex);
      if (cards.length + content.length > 500) {
        return yield* Effect.fail({
          _tag: "KnowledgeAreaImportError",
          reason: "limits-exceeded",
        } as const);
      }
      for (const [variantIndex, rendered] of content.entries()) {
        const expanded = card.kind === "cloze" && card.deletionIndex === undefined;
        const deletionIndex = "deletionIndex" in rendered ? rendered.deletionIndex : undefined;
        const variantSourceId = expanded
          ? stableSyncId(`cloze:${card.sourceId ?? card.id}:${String(deletionIndex)}`)
          : (card.sourceId ?? card.id);
        const id = preserveIds
          ? expanded && variantIndex > 0
            ? createAssessmentId(stableSyncId(`cloze:${card.id}:${String(deletionIndex)}`))
            : card.id
          : createAssessmentId(createId());
        if (outputIds.has(id)) {
          return yield* Effect.fail({
            _tag: "KnowledgeAreaImportError",
            reason: "invalid-document",
          } as const);
        }
        outputIds.add(id);
        cards.push({
          id,
          ...(expanded || !preserveIds || card.sourceId ? { sourceId: variantSourceId } : {}),
          front: rendered.front,
          back: rendered.back,
          ...(card.kind === "cloze" && typeof deletionIndex === "number"
            ? { cloze: { text: card.text, deletionIndex } }
            : {}),
          ...(card.media ? { media: card.media } : {}),
          objective:
            card.objectiveIds.map((id) => titleById.get(id) ?? "Learning objective").join(" · ") ||
            "Learning objective",
          objectiveIds: card.objectiveIds.map((id) => localObjectiveIdByDocumentId.get(id) ?? id),
          tags: card.tags,
          origin: preserveIds || card.kind === "cloze" ? card.origin : "imported",
          schedule: newSchedule(now),
        });
      }
    }
    return {
      id: preserveIds ? document.id : createAreaId(createId()),
      ...(document.sourceId
        ? { sourceId: document.sourceId }
        : preserveIds
          ? {}
          : { sourceId: document.id }),
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
      ...(document.forkedFromVersionId
        ? { forkedFromVersionId: document.forkedFromVersionId }
        : {}),
    };
  });
}
