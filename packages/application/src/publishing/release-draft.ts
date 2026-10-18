import { Effect, Schema } from "effect";
import { KnowledgeAreaSchema, type KnowledgeArea } from "@recall/domain";
import { diffKnowledgeAreas, type KnowledgeAreaDiff } from "./knowledge-area-diff";

const DraftSchema = Schema.Struct({
  areaId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  visibility: Schema.Literal("public", "unlisted"),
  releaseNotes: Schema.String.pipe(Schema.maxLength(4_000)),
  attribution: Schema.String.pipe(Schema.maxLength(200)),
  license: Schema.String.pipe(Schema.maxLength(120)),
  reuseConfirmed: Schema.Boolean,
  difficulty: Schema.optional(Schema.Literal("beginner", "intermediate", "advanced")),
  updatedAt: Schema.Number.pipe(Schema.finite(), Schema.greaterThan(0)),
});
export type ReleaseDraft = Schema.Schema.Type<typeof DraftSchema>;
export type ReleaseDraftStore = {
  readonly read: (areaId: string) => Effect.Effect<unknown, unknown>;
  readonly write: (areaId: string, value: string) => Effect.Effect<void, unknown>;
  readonly clear: (areaId: string) => Effect.Effect<void, unknown>;
};
export type ReleaseDraftFailure = {
  readonly _tag: "ReleaseDraftFailure";
  readonly reason: "storage" | "invalid";
};

export function scopeReleaseDraftStore(store: ReleaseDraftStore, scope: string): ReleaseDraftStore {
  const boundedScope =
    scope
      .trim()
      .replace(/[^A-Za-z0-9.-]/g, "_")
      .slice(0, 120) || "local";
  return {
    read: (key) => store.read(`${boundedScope}--${key}`),
    write: (key, value) => store.write(`${boundedScope}--${key}`, value),
    clear: (key) => store.clear(`${boundedScope}--${key}`),
  };
}

/** Read a bounded, area-scoped publishing form draft. Malformed or expired values are discarded. */
export function readReleaseDraft(store: ReleaseDraftStore, areaId: string, now = Date.now()) {
  return store.read(areaId).pipe(
    Effect.mapError(() => ({ _tag: "ReleaseDraftFailure", reason: "storage" }) as const),
    Effect.flatMap((raw) => {
      if (raw === null) return Effect.succeed(null);
      return Effect.try({
        try: () =>
          typeof raw === "string" && raw.length <= 16_000 ? (JSON.parse(raw) as unknown) : null,
        catch: () => null,
      }).pipe(
        Effect.flatMap(Schema.decodeUnknown(DraftSchema)),
        Effect.map((draft) =>
          draft.areaId === areaId &&
          draft.updatedAt <= now &&
          now - draft.updatedAt <= 30 * 24 * 60 * 60 * 1000
            ? draft
            : null,
        ),
        Effect.catchAll(() => Effect.succeed(null)),
      );
    }),
  );
}

/** Persist only release form fields; content, cards, study state, attempts, and answers are excluded. */
export function writeReleaseDraft(store: ReleaseDraftStore, draft: ReleaseDraft) {
  return Schema.decodeUnknown(DraftSchema)(draft).pipe(
    Effect.mapError(() => ({ _tag: "ReleaseDraftFailure", reason: "invalid" }) as const),
    Effect.flatMap((validated) =>
      store
        .write(validated.areaId, JSON.stringify(validated))
        .pipe(Effect.mapError(() => ({ _tag: "ReleaseDraftFailure", reason: "storage" }) as const)),
    ),
  );
}

export type ReleasePreview = {
  readonly diff: KnowledgeAreaDiff;
  readonly warnings: readonly string[];
};

/** Describe the exact portable content delta and identify edits that can invalidate references. */
export function previewRelease(baseline: unknown, candidate: unknown) {
  return diffKnowledgeAreas({ baseline, candidate }).pipe(
    Effect.map((diff): ReleasePreview => {
      const warnings: string[] = [];
      const removedCards = diff.cards.removed.length;
      const changedCards = diff.cards.changed.length;
      const removedActivities = diff.activities.removed.length;
      const changedActivities = diff.activities.changed.length;
      const removedObjectives = diff.objectives.removed.length;
      if (removedCards || changedCards)
        warnings.push(
          `${String(removedCards + changedCards)} card change${removedCards + changedCards === 1 ? "" : "s"} may invalidate exercise card references.`,
        );
      if (removedActivities || changedActivities)
        warnings.push(
          `${String(removedActivities + changedActivities)} activity change${removedActivities + changedActivities === 1 ? "" : "s"} may invalidate exercise references.`,
        );
      if (removedObjectives)
        warnings.push(
          `${String(removedObjectives)} removed objective${removedObjectives === 1 ? " may" : "s may"} invalidate linked exercise or card references.`,
        );
      return { diff, warnings };
    }),
  );
}

export function releaseDraftForArea(
  area: KnowledgeArea,
  fields: Omit<ReleaseDraft, "areaId" | "updatedAt">,
  now = Date.now(),
): ReleaseDraft {
  return { ...fields, areaId: area.id, updatedAt: now };
}

export function withReleaseDifficulty(
  area: KnowledgeArea,
  difficulty: "beginner" | "intermediate" | "advanced" | "",
): KnowledgeArea {
  const portableContent = { ...area };
  Reflect.deleteProperty(portableContent, "difficulty");
  return difficulty ? { ...portableContent, difficulty } : portableContent;
}

/** Read a validated portable snapshot belonging to the previous owned release. */
export function readReleaseBaseline(store: ReleaseDraftStore, areaId: string) {
  return store.read(`last-release:${areaId}`).pipe(
    Effect.mapError(() => ({ _tag: "ReleaseDraftFailure", reason: "storage" }) as const),
    Effect.flatMap((raw) => {
      if (typeof raw !== "string" || raw.length > 2_000_000) return Effect.succeed(null);
      return Effect.try({ try: () => JSON.parse(raw) as unknown, catch: () => null }).pipe(
        Effect.flatMap(Schema.decodeUnknown(KnowledgeAreaSchema)),
        Effect.map((area) => (area.id === areaId ? area : null)),
        Effect.catchAll(() => Effect.succeed(null)),
      );
    }),
  );
}

/** Save only validated portable content. Learner attempts and review answers are excluded by schema. */
export function writeReleaseBaseline(store: ReleaseDraftStore, area: KnowledgeArea) {
  return Schema.decodeUnknown(KnowledgeAreaSchema)(area).pipe(
    Effect.mapError(() => ({ _tag: "ReleaseDraftFailure", reason: "invalid" }) as const),
    Effect.flatMap((content): Effect.Effect<void, ReleaseDraftFailure> => {
      const serialized = JSON.stringify(content);
      return serialized.length > 2_000_000
        ? Effect.fail({ _tag: "ReleaseDraftFailure", reason: "invalid" } as const)
        : store
            .write(`last-release:${area.id}`, serialized)
            .pipe(
              Effect.mapError(() => ({ _tag: "ReleaseDraftFailure", reason: "storage" }) as const),
            );
    }),
  );
}
