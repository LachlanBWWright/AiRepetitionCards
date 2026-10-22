import { Effect } from "effect";
import {
  createAssessmentId,
  type AreaId,
  type Assessment,
  type AssessmentId,
  type LearningArea,
  type NoteType,
  type Workspace,
} from "@recall/domain";
import { stableSyncId } from "@recall/sync-core";
import { saveStudyNote } from "../notes/save";
import { CLOZE_NOTE_TYPE, previewStudyNote } from "../notes/preview";
import { expandCloze } from "./cloze";
import {
  createStudyCard,
  prepareStudyCardContent,
  updateStudyCard,
  type CardContent,
} from "./card-management";
import { reconcileOcclusionCards } from "./reconcile-occlusion";
import {
  authoringFailure,
  failure,
  type WorkspaceAuthoringFailure,
} from "./workspace-authoring-validation";

type CardDraft = { readonly cardId: AssessmentId; readonly content: CardContent };
function sameSource(left: Assessment, right: Assessment): boolean {
  if (left.noteId || right.noteId) return left.noteId === right.noteId;
  if (!left.cloze || !right.cloze || left.cloze.text !== right.cloze.text) return false;
  if (left.siblingId || right.siblingId) return left.siblingId === right.siblingId;
  return (
    JSON.stringify([
      left.tags ?? [],
      left.media ?? [],
      left.objectiveIds ?? [],
      left.presentation,
    ]) ===
    JSON.stringify([
      right.tags ?? [],
      right.media ?? [],
      right.objectiveIds ?? [],
      right.presentation,
    ])
  );
}
/** Identifies one editable source field, including legacy siblings before their first adoption. */
export function clozeSourceIdentity(area: LearningArea, card: Assessment): string | undefined {
  if (!card.cloze) return undefined;
  if (card.noteId) {
    const note = area.noteLibrary?.notes.find((item) => item.id === card.noteId);
    const type = area.noteLibrary?.types.find((item) => item.id === note?.typeId);
    const field = type?.templates.find((item) => item.id === card.templateId)?.clozeField;
    return JSON.stringify([area.id, "note", card.noteId, field ?? card.templateId]);
  }
  return card.siblingId
    ? JSON.stringify([area.id, "siblings", card.siblingId, card.cloze.text])
    : JSON.stringify([
        area.id,
        "legacy",
        card.cloze.text,
        card.tags ?? [],
        card.media ?? [],
        card.objectiveIds ?? [],
        card.presentation,
      ]);
}

function freshCardId(workspace: Workspace, noteId: string, key: string): AssessmentId {
  const used = new Set([
    ...workspace.areas.flatMap((area) => area.cards.map((card) => card.id)),
    ...(workspace.retainedReviewAreas ?? []).flatMap((area) => area.cards.map((card) => card.id)),
    ...(workspace.deletedCards ?? []).map((card) => card.cardId),
    ...(workspace.cardVersions ?? []).map((card) => card.cardId),
    ...(workspace.reviewEvents ?? []).map((event) => event.cardId),
  ]);
  let attempt = 0;
  let id = createAssessmentId(stableSyncId(`cloze-card:${noteId}:${key}:${String(attempt)}`));
  while (used.has(id)) {
    attempt += 1;
    id = createAssessmentId(stableSyncId(`cloze-card:${noteId}:${key}:${String(attempt)}`));
  }
  return id;
}

function linkClozeSource(
  workspace: Workspace,
  area: LearningArea,
  anchor: Assessment,
  siblings: readonly Assessment[],
  content: CardContent,
  now: Date,
): Effect.Effect<Workspace, WorkspaceAuthoringFailure> {
  return Effect.gen(function* () {
    if (
      !anchor.noteId &&
      new Set(siblings.map((card) => card.cloze?.deletionIndex)).size !== siblings.length
    )
      return yield* Effect.fail(
        failure(
          "invalid-input",
          "These cards repeat a deletion index. Edit or separate the duplicate source before linking them.",
        ),
      );
    const expanded = yield* expandCloze(content.cloze?.text).pipe(
      Effect.mapError(authoringFailure),
    );
    const first = expanded[0];
    if (!first)
      return yield* Effect.fail(failure("invalid-input", "The cloze needs at least one deletion."));
    // Validate metadata independently of the old selected index, which may have been removed.
    const prepared = yield* prepareStudyCardContent(
      area,
      { ...content, cloze: { text: first.text, deletionIndex: first.deletionIndex } },
      anchor,
    ).pipe(Effect.mapError(authoringFailure));
    const noteId = anchor.noteId ?? stableSyncId(`cloze-note:${area.id}:${anchor.id}`);
    const previousNote = area.noteLibrary?.notes.find((note) => note.id === noteId);
    if (previousNote?.source)
      return yield* Effect.fail(
        failure(
          "invalid-input",
          "Edit this linked source note using the shared note editor in its original subject.",
        ),
      );
    const previousType = area.noteLibrary?.types.find((type) => type.id === previousNote?.typeId);
    const previousTemplate = previousType?.templates.find(
      (template) => template.id === anchor.templateId,
    );
    if (anchor.noteId && (!previousNote || !previousType || !previousTemplate?.clozeField))
      return yield* Effect.fail(
        failure("invalid-input", "Edit this shared note using the note editor."),
      );
    const sourceField = previousTemplate?.clozeField ?? "Text";
    const templateId = previousTemplate?.id ?? "cloze";
    const sharedTypeId = stableSyncId(`cloze-type:${JSON.stringify(content.presentation ?? null)}`);
    const sharedType = area.noteLibrary?.types.find((item) => item.id === sharedTypeId);
    const type: NoteType = previousType ??
      sharedType ?? {
        ...CLOZE_NOTE_TYPE,
        id: sharedTypeId,
        templates: CLOZE_NOTE_TYPE.templates.map((template) => ({
          ...template,
          presentation: content.presentation,
        })),
      };
    const note = {
      id: noteId,
      typeId: type.id,
      fields: { ...(previousNote?.fields ?? {}), [sourceField]: first.text },
      tags: prepared.tags,
      objectiveIds: prepared.objectiveIds,
      media: prepared.media,
    };
    const linkedIds = new Set(siblings.map((card) => card.id));
    const linked = {
      ...workspace,
      areas: workspace.areas.map((item) =>
        item.id === area.id
          ? {
              ...item,
              cards: item.cards.map((card) =>
                !card.noteId && linkedIds.has(card.id) ? { ...card, noteId, templateId } : card,
              ),
            }
          : item,
      ),
    };
    const previews = yield* previewStudyNote(type, note).pipe(Effect.mapError(authoringFailure));
    const cardIds = previews.map((preview) => ({
      templateId: preview.templateId,
      ...(preview.deletionIndex === undefined ? {} : { deletionIndex: preview.deletionIndex }),
      cardId: freshCardId(
        linked,
        noteId,
        `${preview.templateId}:${String(preview.deletionIndex ?? 0)}`,
      ),
    }));
    return yield* saveStudyNote(
      linked,
      { areaId: area.id, note, ...(previousType || sharedType ? {} : { type }), cardIds },
      now,
    ).pipe(Effect.mapError(authoringFailure));
  });
}

/** Ordinary cloze forms create a linked source while retaining caller-supplied selected IDs. */
export function createAuthoredCards(
  workspace: Workspace,
  areaId: AreaId,
  cards: readonly CardDraft[],
  now: Date,
): Effect.Effect<Workspace, WorkspaceAuthoringFailure> {
  return Effect.gen(function* () {
    let next = workspace;
    for (const draft of cards)
      next = yield* createStudyCard(next, { ...draft, areaId }, now).pipe(
        Effect.flatMap((created) =>
          reconcileOcclusionCards(created, areaId, draft.cardId, now, next),
        ),
        Effect.mapError(authoringFailure),
      );
    const pending = new Set(
      cards.filter((draft) => draft.content.kind === "cloze").map((draft) => draft.cardId),
    );
    for (const draft of cards) {
      if (!pending.has(draft.cardId)) continue;
      const area = next.areas.find((item) => item.id === areaId);
      const anchor = area?.cards.find((card) => card.id === draft.cardId);
      if (!area || !anchor)
        return yield* Effect.fail(
          failure("authoring-rejected", "The cloze source no longer exists."),
        );
      const siblings = area.cards.filter(
        (card) => pending.has(card.id) && sameSource(anchor, card),
      );
      for (const card of siblings) pending.delete(card.id);
      next = yield* linkClozeSource(next, area, anchor, siblings, draft.content, now);
    }
    return next;
  });
}

/** Adopt legacy siblings on first edit; unchanged deletion identities keep their schedule/history. */
export function updateAuthoredCard(
  workspace: Workspace,
  areaId: AreaId,
  draft: CardDraft,
  now: Date,
): Effect.Effect<Workspace, WorkspaceAuthoringFailure> {
  const area = workspace.areas.find((item) => item.id === areaId);
  const card = area?.cards.find((item) => item.id === draft.cardId);
  if (area && card?.cloze && draft.content.kind === "cloze") {
    const siblings = area.cards.filter((item) => sameSource(card, item));
    return linkClozeSource(workspace, area, card, siblings, draft.content, now);
  }
  return updateStudyCard(workspace, { ...draft, areaId }, now).pipe(
    Effect.flatMap((updated) =>
      reconcileOcclusionCards(updated, areaId, draft.cardId, now, workspace),
    ),
    Effect.mapError(authoringFailure),
  );
}
