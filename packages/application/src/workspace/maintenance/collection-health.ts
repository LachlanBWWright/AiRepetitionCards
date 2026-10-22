import { collectionNoteOwnershipConflicts } from "../../notes/ownership";
import { Effect, Schema } from "effect";
import {
  MediaReferenceSchema,
  WorkspaceSchema,
  type AssessmentId,
  type LearningArea,
  type MediaReference,
  type Workspace,
} from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import { workspaceMediaReferences } from "../media/media-references";
import { verifyMediaAsset } from "../../interchange/knowledge-area-package";
import { renderClozeCard } from "../../authoring/cloze";
import { parseRichContent } from "../../authoring/rich-content";
import { captureCardVersion } from "../../card-history";
export type CollectionIssue = {
  readonly areaId: string;
  readonly cardId: AssessmentId;
  readonly message: string;
  readonly empty: boolean;
};
export type CollectionHealth = {
  readonly missing: readonly MediaReference[];
  readonly unused: readonly MediaReference[];
  readonly corrupt: readonly MediaReference[];
  readonly issues: readonly CollectionIssue[];
  readonly checkedAssets: number;
};
export function collectionCardIssues(workspace: Workspace): readonly CollectionIssue[] {
  const issues: CollectionIssue[] = [];
  const ownershipConflicts = new Set(
    collectionNoteOwnershipConflicts(workspace).map((item) =>
      JSON.stringify([item.areaId, item.noteId]),
    ),
  );
  for (const area of workspace.areas)
    for (const card of area.cards) {
      const add = (message: string, empty = false) => {
        issues.push({ areaId: area.id, cardId: card.id, message, empty });
      };
      if (!card.front.trim() || !card.back.trim()) add("Question or answer is empty.", true);
      if (
        card.objectiveIds?.some((id) => !area.objectives?.some((objective) => objective.id === id))
      )
        add("A learning objective reference is missing.");
      const sourceNote = area.noteLibrary?.notes.find((note) => note.id === card.noteId);
      if (card.noteId && !sourceNote) add("The shared source note is missing.");
      if (card.noteId && ownershipConflicts.has(JSON.stringify([area.id, card.noteId])))
        add(
          "Linked note snapshot differs from its source. Open the shared source editor to review the conflict.",
        );
      if (
        sourceNote?.source &&
        !workspace.areas.some((item) => item.id === sourceNote.source?.areaId)
      )
        add("The original subject for this linked note is unavailable.");
      if (
        sourceNote &&
        !area.noteLibrary?.types
          .find((type) => type.id === sourceNote.typeId)
          ?.templates.some((template) => template.id === card.templateId)
      )
        add("The source card template is missing.");
      const inlineImages = parseRichContent(`${card.front}\n${card.back}`)
        .flatMap((block) => block.content)
        .filter((inline) => inline.kind === "image");
      if (
        inlineImages.some(
          (inline) =>
            !card.media?.some(
              (reference) =>
                reference.id === inline.mediaId && reference.mimeType.startsWith("image/"),
            ),
        )
      )
        add("An inline image reference is not attached.");
      if (
        card.imageOcclusion &&
        !card.media?.some(
          (reference) =>
            reference.id === card.imageOcclusion?.imageMediaId &&
            reference.mimeType.startsWith("image/"),
        )
      )
        add("The masked image is not attached.");
      if (card.cloze) {
        const rendered = Effect.runSync(
          Effect.either(renderClozeCard(card.cloze.text, card.cloze.deletionIndex)),
        );
        if (rendered._tag === "Left") add("Cloze source has no valid selected deletion.", true);
        else if (rendered.right.front !== card.front || rendered.right.back !== card.back)
          add("Cloze display differs from its source. Reopen the shared source editor.");
      }
    }
  return issues;
}
/** Read-only, sequential verification avoids retaining all media bytes in memory. */
export function inspectCollection(
  input: unknown,
  media: MediaStore,
  protectedReferences: readonly MediaReference[] = [],
): Effect.Effect<CollectionHealth, { readonly message: string }> {
  return Effect.gen(function* () {
    const unavailable = {
      message: "Collection media could not be read. Restore storage and try again.",
    };
    const workspace = yield* Schema.decodeUnknown(WorkspaceSchema)(input).pipe(
      Effect.mapError(() => unavailable),
    );
    const available = yield* media.list.pipe(Effect.mapError(() => unavailable));
    const references = [
      ...new Map(
        [...workspaceMediaReferences(workspace), ...protectedReferences].map((reference) => [
          reference.id,
          reference,
        ]),
      ).values(),
    ];
    const used = new Set(references.map((reference) => reference.id));
    const trashed = new Set(workspace.mediaTrash?.map((entry) => entry.reference.id));
    const stored = new Map(available.map((reference) => [reference.id, reference]));
    const expected = new Map(references.map((reference) => [reference.id, reference]));
    const missing = references.filter((reference) => !stored.has(reference.id));
    const unused = available.filter(
      (reference) => !used.has(reference.id) && !trashed.has(reference.id),
    );
    const corrupt: MediaReference[] = [];
    let checkedAssets = 0;
    for (const reference of available) {
      const asset = yield* media.get(reference.id).pipe(Effect.mapError(() => unavailable));
      const contentReference = expected.get(reference.id);
      if (
        !asset ||
        !verifyMediaAsset(asset) ||
        (contentReference &&
          (asset.reference.mimeType !== contentReference.mimeType ||
            asset.reference.byteLength !== contentReference.byteLength))
      )
        corrupt.push(reference);
      checkedAssets += 1;
      if (checkedAssets % 20 === 0) yield* Effect.yieldNow();
    }
    return { missing, unused, corrupt, issues: collectionCardIssues(workspace), checkedAssets };
  });
}
export const MediaMaintenanceCommandSchema = Schema.Struct({
  kind: Schema.Literal("maintain-collection-media"),
  action: Schema.Literal("trash", "restore", "tag-missing"),
  references: Schema.Array(MediaReferenceSchema).pipe(Schema.maxItems(10000)),
});
export function maintainCollectionMedia(
  workspace: Workspace,
  command: typeof MediaMaintenanceCommandSchema.Type,
  now: Date,
) {
  return Effect.gen(function* () {
    if (!Number.isFinite(now.getTime()))
      return yield* Effect.fail({ message: "The cleanup time is invalid." });
    const ids = new Set(command.references.map((reference) => reference.id));
    const used = new Set(workspaceMediaReferences(workspace).map((reference) => reference.id));
    if (command.action === "trash" && [...ids].some((id) => used.has(id)))
      return yield* Effect.fail({
        message:
          "A selected file is now used by content or history. Scan again before moving files to trash.",
      });
    if (command.action === "tag-missing") {
      let versioned = workspace;
      for (const area of workspace.areas) {
        const affectedNotes =
          area.noteLibrary?.notes.filter((note) =>
            note.media?.some((reference) => ids.has(reference.id)),
          ) ?? [];
        if (
          affectedNotes.some(
            (note) => !note.tags.includes("missing-media") && note.tags.length >= 100,
          )
        )
          return yield* Effect.fail({
            message:
              "A source note already has 100 tags. Remove a tag before marking missing media.",
          });
        for (const card of area.cards) {
          if (
            (card.media?.some((reference) => ids.has(reference.id)) ||
              affectedNotes.some((note) => note.id === card.noteId)) &&
            !card.tags?.includes("missing-media")
          )
            versioned = captureCardVersion(versioned, area, card, "edit", now);
        }
      }
      return {
        ...versioned,
        areas: workspace.areas.map((area) => tagMissingMedia(area, ids)),
      };
    }
    const trash = new Map(workspace.mediaTrash?.map((entry) => [entry.reference.id, entry]));
    for (const reference of command.references)
      if (command.action === "trash")
        trash.set(reference.id, { reference, trashedAt: now.toISOString() });
      else trash.delete(reference.id);
    return { ...workspace, mediaTrash: [...trash.values()] };
  });
}

function tagMissingMedia(area: LearningArea, ids: ReadonlySet<string>): LearningArea {
  const affected = new Set(
    area.noteLibrary?.notes
      .filter((note) => note.media?.some((reference) => ids.has(reference.id)))
      .map((note) => note.id),
  );
  const cards = area.cards.map((card) =>
    card.media?.some((reference) => ids.has(reference.id)) ||
    (card.noteId && affected.has(card.noteId))
      ? { ...card, tags: [...new Set([...(card.tags ?? []), "missing-media"])] }
      : card,
  );
  if (!area.noteLibrary) return { ...area, cards };
  const notes = area.noteLibrary.notes.map((note) =>
    affected.has(note.id) ? { ...note, tags: [...new Set([...note.tags, "missing-media"])] } : note,
  );
  return { ...area, cards, noteLibrary: { ...area.noteLibrary, notes } };
}
