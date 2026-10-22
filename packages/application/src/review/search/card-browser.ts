import { resolveNoteSource } from "../../notes/ownership";
import { replaceNoteFields } from "./note-replacement";
import { clozeSourceIdentity, updateAuthoredCard } from "../../authoring/cloze-note-authoring";
import { Effect, Schema } from "effect";
import { AreaIdSchema, AssessmentIdSchema, type Assessment, type Workspace } from "@recall/domain";
import { updateStudyCard } from "../../authoring/card-management";
import { createStudySearchIndex, type StudySearchIndex } from "./search-index";
import { searchStudyCards, type StudyCardMatch } from "./card-search";
export type BrowserColumn =
  "subject" | "front" | "back" | "due" | "interval" | "lapses" | "tags" | "state";
export const browserColumns: readonly BrowserColumn[] = [
  "subject",
  "front",
  "back",
  "due",
  "interval",
  "lapses",
  "tags",
  "state",
];
export const defaultBrowserColumns: readonly BrowserColumn[] = [
  "subject",
  "front",
  "due",
  "interval",
  "tags",
];
export function browserCell(entry: StudyCardMatch, column: BrowserColumn): string {
  const card = entry.card;
  switch (column) {
    case "subject":
      return entry.area.title;
    case "front":
      return card.front;
    case "back":
      return card.back;
    case "due":
      return card.schedule.due;
    case "interval":
      return String(card.schedule.scheduled_days);
    case "lapses":
      return String(card.schedule.lapses);
    case "tags":
      return (card.tags ?? []).join(", ");
    case "state":
      return ["New", "Learning", "Review", "Relearning"][card.schedule.state] ?? "Unknown";
  }
}
export function browseStudyCards(
  workspace: Workspace,
  query: string,
  now: number,
  column: BrowserColumn,
  descending: boolean,
  areaId?: string,
  index: StudySearchIndex = createStudySearchIndex(workspace),
) {
  const compare = (a: StudyCardMatch, b: StudyCardMatch) => {
    let difference = browserCell(a, column).localeCompare(browserCell(b, column), "en", {
      numeric: true,
    });
    if (column === "interval")
      difference = a.card.schedule.scheduled_days - b.card.schedule.scheduled_days;
    if (column === "lapses") difference = a.card.schedule.lapses - b.card.schedule.lapses;
    return difference * (descending ? -1 : 1) || a.card.id.localeCompare(b.card.id);
  };
  return searchStudyCards(workspace, query, now, areaId, index).pipe(
    Effect.map((entries) => [...entries].sort(compare)),
  );
}
export function tagHierarchy(workspace: Workspace) {
  const counts = new Map<string, Set<string>>();
  for (const area of workspace.areas)
    for (const card of area.cards)
      for (const tag of card.tags ?? []) {
        const parts = tag.split("::");
        for (let depth = 1; depth <= parts.length; depth += 1) {
          const path = parts.slice(0, depth).join("::");
          const ids = counts.get(path) ?? new Set<string>();
          ids.add(card.id);
          counts.set(path, ids);
        }
      }
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, ids]) => ({ tag, count: ids.size, depth: tag.split("::").length - 1 }));
}
export function relatedStudyCards(workspace: Workspace, card: Assessment) {
  return workspace.areas.flatMap((area) =>
    area.cards
      .filter(
        (candidate) =>
          candidate.id !== card.id &&
          ((card.siblingId && candidate.siblingId === card.siblingId) ||
            (card.cloze && candidate.cloze?.text === card.cloze.text) ||
            candidate.objectiveIds?.some((id) => card.objectiveIds?.includes(id))),
      )
      .map((related) => ({ area, card: related })),
  );
}
export const ReplaceCardFieldsSchema = Schema.Struct({
  kind: Schema.Literal("replace-card-fields"),
  areaId: AreaIdSchema,
  cardIds: Schema.Array(AssessmentIdSchema).pipe(Schema.minItems(1), Schema.maxItems(500)),
  field: Schema.Literal("front", "back", "cloze", "note"),
  noteField: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80))),
  find: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20000)),
  replacement: Schema.String.pipe(Schema.maxLength(20000)),
});
export function previewFieldReplacement(
  card: Assessment,
  field: "front" | "back" | "cloze",
  find: string,
  replacement: string,
) {
  if (card.noteId && field !== "cloze") return undefined;
  const before = field === "cloze" ? card.cloze?.text : card.cloze ? undefined : card[field];
  if (!find || before === undefined || !before.includes(find)) return undefined;
  const after = before.replaceAll(find, replacement);
  return before === after ? undefined : { before, after };
}
/** Atomic batch: any invalid cloze/empty field rejects the entire proposal, with version history. */
export function replaceCardFields(
  workspace: Workspace,
  command: typeof ReplaceCardFieldsSchema.Type,
  now: Date,
) {
  return Effect.gen(function* () {
    const area = workspace.areas.find((item) => item.id === command.areaId);
    if (!area || command.cardIds.some((id) => !area.cards.some((card) => card.id === id)))
      return yield* Effect.fail({
        message: "Some selected cards no longer exist. Reopen the browser.",
      });
    if (command.field === "note") {
      if (!command.noteField) return yield* Effect.fail({ message: "Choose a source note field." });
      return yield* replaceNoteFields(
        workspace,
        area.id,
        command.cardIds,
        command.noteField,
        command.find,
        command.replacement,
        now,
      );
    }
    let next = workspace;
    const processedSources = new Set<string>();
    for (const card of area.cards.filter((item) => command.cardIds.includes(item.id))) {
      const source = command.field === "cloze" ? clozeSourceIdentity(area, card) : undefined;
      if (source && processedSources.has(source)) continue;
      const preview = previewFieldReplacement(
        card,
        command.field,
        command.find,
        command.replacement,
      );
      if (!preview) continue;
      if (source) processedSources.add(source);
      const cloze = card.cloze ? { ...card.cloze, text: preview.after } : undefined;
      const draft = {
        cardId: card.id,
        content: {
          kind: card.cloze ? ("cloze" as const) : ("basic" as const),
          front: command.field === "front" ? preview.after : card.front,
          back: command.field === "back" ? preview.after : card.back,
          ...(cloze ? { cloze } : {}),
          objectiveIds: card.objectiveIds ?? [],
          tags: card.tags ?? [],
          media: card.media ?? [],
          presentation: card.presentation,
          imageOcclusion: card.imageOcclusion,
        },
      };
      next = card.cloze
        ? yield* updateAuthoredCard(next, area.id, draft, now)
        : yield* updateStudyCard(next, { ...draft, areaId: area.id }, now);
    }
    return next;
  });
}

export function browserNoteRows(
  entries: readonly StudyCardMatch[],
  workspace?: Workspace,
): readonly StudyCardMatch[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const source = workspace
      ? resolveNoteSource(workspace, entry.area, entry.card.noteId)
      : { area: entry.area, noteId: entry.card.noteId };
    const key = JSON.stringify([
      source.area.id,
      source.noteId ? "note" : "card",
      source.noteId ?? entry.card.id,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
