import { Effect, Either, Schema } from "effect";
import { WorkspaceSchema, type Workspace } from "@recall/domain";
import type { AnkiImportProposal } from "./anki-import-contracts";

export type AnkiReimportFailure = {
  readonly _tag: "AnkiReimportFailure";
  readonly reason: "ambiguous-matches" | "invalid-workspace" | "partial-note-family";
};

/** Update matching GUID/template identities without replacing the learner's existing evidence. */
export function applyAnkiImport(
  workspace: Workspace,
  proposal: AnkiImportProposal,
): Effect.Effect<Workspace, AnkiReimportFailure> {
  const incoming = proposal.area;
  const sources = new Set(incoming.cards.map((card) => card.sourceId).filter(Boolean));
  const targets = workspace.areas.filter((area) =>
    area.cards.some((card) => card.sourceId && sources.has(card.sourceId)),
  );
  if (targets.length > 1)
    return Effect.fail({ _tag: "AnkiReimportFailure", reason: "ambiguous-matches" });
  const target = targets[0];
  if (!target) {
    return validate({
      ...workspace,
      areas: [...workspace.areas, incoming],
      schedulerSettings: addSuspensions(workspace, proposal.suspendedCardIds ?? []),
      reviews: workspace.reviews + proposal.reviewEvents.length,
      reviewEvents: [...(workspace.reviewEvents ?? []), ...proposal.reviewEvents],
    });
  }
  const priorBySource = new Map(target.cards.map((card) => [card.sourceId, card]));
  if (
    target.cards.filter((card) => card.sourceId && sources.has(card.sourceId)).length !==
    new Set(
      target.cards
        .filter((card) => card.sourceId && sources.has(card.sourceId))
        .map((card) => card.sourceId),
    ).size
  )
    return Effect.fail({ _tag: "AnkiReimportFailure", reason: "ambiguous-matches" });
  const noteIds = new Map<string, string>();
  const cardIds = new Map<string, (typeof incoming.cards)[number]["id"]>();
  const matched = new Set<string>();
  const cards = incoming.cards.map((card) => {
    const prior = card.sourceId ? priorBySource.get(card.sourceId) : undefined;
    cardIds.set(card.id, prior?.id ?? card.id);
    if (card.noteId) noteIds.set(card.noteId, prior?.noteId ?? card.noteId);
    if (!prior) return card;
    matched.add(prior.id);
    return {
      ...card,
      importedSchedule: prior.importedSchedule,
      id: prior.id,
      schedule: prior.schedule,
      objectiveIds: prior.objectiveIds,
      ...(prior.noteId ? { noteId: prior.noteId } : {}),
    };
  });
  const typeIds = new Map<string, string>();
  const types = [...(target.noteLibrary?.types ?? [])];
  for (const type of incoming.noteLibrary?.types ?? []) {
    const existing = types.find((item) => item.id === type.id);
    let id = type.id;
    if (existing && JSON.stringify(existing) !== JSON.stringify(type)) {
      let suffix = 1;
      while (types.some((item) => item.id === `${type.id}:import-${String(suffix)}`)) suffix += 1;
      id = `${type.id}:import-${String(suffix)}`;
    }
    typeIds.set(type.id, id);
    if (!existing || id !== type.id) types.push({ ...type, id });
  }
  const notes = (incoming.noteLibrary?.notes ?? []).map((note) => ({
    ...note,
    id: noteIds.get(note.id) ?? note.id,
    typeId: typeIds.get(note.typeId) ?? note.typeId,
  }));
  const replacedNotes = new Set(notes.map((note) => note.id));
  if (
    target.cards.some(
      (card) => card.noteId && replacedNotes.has(card.noteId) && !matched.has(card.id),
    )
  )
    return Effect.fail({ _tag: "AnkiReimportFailure", reason: "partial-note-family" });
  const newEvents = proposal.reviewEvents
    .filter((event) => !matched.has(cardIds.get(event.cardId) ?? event.cardId))
    .map((event) => ({
      ...event,
      areaId: target.id,
      cardId: cardIds.get(event.cardId) ?? event.cardId,
    }));
  const updated = {
    ...target,
    cards: [
      ...target.cards.filter((card) => !matched.has(card.id)),
      ...cards.map((card) => ({
        ...card,
        ...(card.noteId ? { noteId: noteIds.get(card.noteId) ?? card.noteId } : {}),
      })),
    ],
    objectives: [
      ...(target.objectives ?? []),
      ...(incoming.objectives ?? []).filter(
        (objective) => !(target.objectives ?? []).some((item) => item.id === objective.id),
      ),
    ],
    ...(types.length > 0
      ? {
          noteLibrary: {
            types,
            notes: [
              ...(target.noteLibrary?.notes ?? []).filter((note) => !replacedNotes.has(note.id)),
              ...notes,
            ],
          },
        }
      : {}),
  };
  return validate({
    ...workspace,
    areas: workspace.areas.map((area) => (area.id === target.id ? updated : area)),
    schedulerSettings: addSuspensions(
      workspace,
      (proposal.suspendedCardIds ?? []).filter((id) => !matched.has(cardIds.get(id) ?? id)),
    ),
    reviews: workspace.reviews + newEvents.length,
    reviewEvents: [...(workspace.reviewEvents ?? []), ...newEvents],
  });
}

function validate(input: unknown): Effect.Effect<Workspace, AnkiReimportFailure> {
  const decoded = Schema.decodeUnknownEither(WorkspaceSchema)(input);
  return Either.isRight(decoded)
    ? Effect.succeed(decoded.right)
    : Effect.fail({ _tag: "AnkiReimportFailure", reason: "invalid-workspace" });
}

function addSuspensions(
  workspace: Workspace,
  ids: readonly import("@recall/domain").AssessmentId[],
): Workspace["schedulerSettings"] {
  if (ids.length === 0) return workspace.schedulerSettings;
  return {
    ...(workspace.schedulerSettings ?? { requestRetention: 0.9 }),
    suspendedCardIds: [
      ...new Set([...(workspace.schedulerSettings?.suspendedCardIds ?? []), ...ids]),
    ],
  };
}
