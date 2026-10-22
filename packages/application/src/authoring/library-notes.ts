import { NoteAuthoringDraftSchema } from "../notes/drafts";
import { Schema, Effect } from "effect";
import type { StoredMediaAsset } from "@recall/local-store";
import {
  ReviewPresentationSchema,
  ActivityLibrarySchema,
  AssessmentSchema,
  ImageOcclusionDraftSchema,
  MediaReferenceSchema,
} from "@recall/domain";
import { mergeActivityLibraries } from "../activities/learning-activities";

// Drafts may be incomplete or invalid authoring proposals; validate their shape, not card validity.
const text = Schema.String.pipe(Schema.maxLength(100_000));
export const LibraryDraftSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("area"),
    key: Schema.String,
    id: Schema.String,
    mode: Schema.Literal("create", "edit"),
    title: text,
    color: text,
    baseline: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("card"),
    key: Schema.String,
    areaId: Schema.String,
    id: Schema.String,
    mode: Schema.Literal("create", "edit"),
    imageOcclusion: Schema.optional(ImageOcclusionDraftSchema),
    cardKind: Schema.Literal("basic", "cloze"),
    front: text,
    back: text,
    clozeText: text,
    clozeIndex: text,
    presentation: Schema.optional(ReviewPresentationSchema),
    tagsText: text,
    objectiveIds: Schema.Array(Schema.String),
    media: Schema.Array(MediaReferenceSchema),
    removedMediaIds: Schema.Array(Schema.String),
    sourceCard: Schema.optional(AssessmentSchema),
    baseline: Schema.optional(Schema.String),
  }),
);
export type LibraryDraft = typeof LibraryDraftSchema.Type;
export const LibraryNotesSchema = Schema.Struct({
  version: Schema.Literal(1),
  activityLibrary: Schema.optional(ActivityLibrarySchema),
  drafts: Schema.Array(LibraryDraftSchema),
  noteDrafts: Schema.optional(Schema.Array(NoteAuthoringDraftSchema).pipe(Schema.maxItems(500))),
  flaggedCardIds: Schema.Array(Schema.String),
});
export type LibraryNotes = typeof LibraryNotesSchema.Type;
export type LibraryNotesFailure = {
  readonly _tag: "LibraryNotesFailure";
  readonly message: string;
  readonly recovery?: "awaiting-sync" | "conflicted";
};
export type LibraryNotesStore = {
  readonly scope: string;
  readonly persistenceStatus?: () =>
    "saved-locally" | "synchronized" | "awaiting-sync" | "conflicted";
  readonly persistenceLocation?: () => "tab" | "device" | "native";
  readonly read: Effect.Effect<LibraryNotes, LibraryNotesFailure>;
  readonly write: (
    input: unknown,
    assets?: readonly StoredMediaAsset[],
  ) => Effect.Effect<LibraryNotes, LibraryNotesFailure>;
};
export const emptyLibraryNotes: LibraryNotes = { version: 1, drafts: [], flaggedCardIds: [] };

/** Incorporate a committed cloud merge without undoing edits made during the write. */
export function reconcileLibraryNotesWrite(
  submitted: LibraryNotes,
  current: LibraryNotes,
  committed: LibraryNotes | undefined,
): Effect.Effect<LibraryNotes, LibraryNotesFailure> {
  if (!committed?.activityLibrary) return Effect.succeed(current);
  if (submitted.activityLibrary && !current.activityLibrary) return Effect.succeed(current);
  const base = submitted.activityLibrary;
  const latest = current.activityLibrary;
  const retainUnchanged = <A extends { readonly id: string }>(
    saved: readonly A[],
    before: readonly A[],
    after: readonly A[],
  ): readonly A[] => {
    const beforeById = new Map(before.map((entry) => [entry.id, entry]));
    const afterById = new Map(after.map((entry) => [entry.id, entry]));
    return saved.filter((entry) => {
      const previous = beforeById.get(entry.id);
      return (
        previous === undefined ||
        JSON.stringify(previous) === JSON.stringify(afterById.get(entry.id))
      );
    });
  };
  const saved = committed.activityLibrary;
  return mergeActivityLibraries(latest ?? { version: 1, activities: [], attempts: [] }, {
    ...saved,
    activities: retainUnchanged(saved.activities, base?.activities ?? [], latest?.activities ?? []),
    attempts: retainUnchanged(saved.attempts, base?.attempts ?? [], latest?.attempts ?? []),
    drafts: retainUnchanged(saved.drafts ?? [], base?.drafts ?? [], latest?.drafts ?? []),
    editorDrafts: retainUnchanged(
      saved.editorDrafts ?? [],
      base?.editorDrafts ?? [],
      latest?.editorDrafts ?? [],
    ),
  }).pipe(
    Effect.map((activityLibrary) => ({ ...current, activityLibrary })),
    Effect.mapError((error) => ({ _tag: "LibraryNotesFailure" as const, message: error.message })),
  );
}
export function retainLibraryDraft(notes: LibraryNotes, draft: LibraryDraft): LibraryNotes {
  return { ...notes, drafts: [...notes.drafts.filter((entry) => entry.key !== draft.key), draft] };
}
export function discardLibraryDraft(notes: LibraryNotes, key: string): LibraryNotes {
  return { ...notes, drafts: notes.drafts.filter((entry) => entry.key !== key) };
}
export function toggleCardFlag(notes: LibraryNotes, id: string): LibraryNotes {
  return {
    ...notes,
    flaggedCardIds: notes.flaggedCardIds.includes(id)
      ? notes.flaggedCardIds.filter((entry) => entry !== id)
      : [...notes.flaggedCardIds, id],
  };
}
