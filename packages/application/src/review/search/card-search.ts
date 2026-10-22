import {
  createStudySearchIndex,
  normalizeSearchText,
  studyCardKey,
  type StudySearchIndex,
} from "./search-index";
import { extendedTermValid, extendedTermMatches, searchExpression } from "./extended-terms";
import { Effect, Either } from "effect";
import type { Assessment, LearningArea, ReviewEvent, Workspace } from "@recall/domain";
import { studyCardStatus } from "../study-queue";
import {
  matchesStudyQuery,
  parseStudyQuery,
  queryTerms,
  type StudySearchFailure,
  type StudyQuery,
} from "./query-parser";
export type StudyCardMatch = { readonly area: LearningArea; readonly card: Assessment };
const normalize = normalizeSearchText;
const unquote = (value: string) => value.replace(/"/g, "");
const numericFields = new Set(["interval", "stability", "difficulty", "lapses", "reps", "due"]);
const fields = new Set(["tag", "deck", "front", "back", "is", "rated", ...numericFields]);
const states = new Set(["new", "learning", "relearning", "review", "due", "suspended", "leech"]);
function splitTerm(term: string) {
  const colon = term.indexOf(":");
  return colon < 0
    ? { field: "text", value: unquote(term) }
    : { field: term.slice(0, colon).toLowerCase(), value: unquote(term.slice(colon + 1)) };
}
function validTerm(term: string): boolean {
  const { field, value } = splitTerm(term);
  if (field === "text") return true;
  const extended = extendedTermValid(field, value);
  if (extended !== undefined) return extended;
  if (!fields.has(field) || !value) return false;
  if (field === "is") return states.has(value.toLowerCase());
  if (numericFields.has(field)) return /^(?:<=|>=|<|>|=)?-?\d+(?:\.\d+)?$/.test(value);
  if (field === "rated") return /^\d{1,5}(?::(?:again|hard|good|easy))?$/.test(value);
  return true;
}
function compare(actual: number, expression: string): boolean {
  const match = /^(<=|>=|<|>|=)?(-?\d+(?:\.\d+)?)$/.exec(expression);
  if (!match?.[2] || !Number.isFinite(actual)) return false;
  const expected = Number(match[2]);
  switch (match[1]) {
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    case ">":
      return actual > expected;
    case ">=":
      return actual >= expected;
    default:
      return actual === expected;
  }
}
function termMatches(
  term: string,
  entry: StudyCardMatch,
  workspace: Workspace,
  events: readonly ReviewEvent[],
  now: number,
  indexedText: string,
  index: StudySearchIndex,
  expressions: ReadonlyMap<string, RegExp>,
): boolean {
  const { field, value } = splitTerm(term);
  const { card, area } = entry;
  const text = normalize(value);
  const extended = extendedTermMatches(
    field,
    value,
    entry,
    index.sources.get(studyCardKey(entry)),
    expressions.get(value),
  );
  if (extended !== undefined) return extended;
  if (field === "text") return indexedText.includes(text);
  if (field === "deck") return normalize(area.title) === text || area.id === value;
  if (field === "tag")
    return (card.tags ?? []).some((tag) =>
      text.endsWith("*") ? normalize(tag).startsWith(text.slice(0, -1)) : normalize(tag) === text,
    );
  if (field === "front" || field === "back") return normalize(card[field]).includes(text);
  if (field === "rated") {
    const [days, rating] = value.split(":");
    return events.some((event) => {
      const at = Date.parse(event.effectiveReviewedAt ?? event.ratedAt);
      return (
        at <= now && at >= now - Number(days) * 86_400_000 && (!rating || event.rating === rating)
      );
    });
  }
  if (field === "is") {
    const status = studyCardStatus(workspace, card, area.id);
    if (text === "suspended") return status.suspended;
    if (text === "leech") return status.leech;
    if (text === "due") return !status.suspended && Date.parse(card.schedule.due) <= now;
    return (
      card.schedule.state ===
      ({ new: 0, learning: 1, review: 2, relearning: 3 } as Readonly<Record<string, number>>)[text]
    );
  }
  const numeric: Readonly<Record<string, number>> = {
    interval: card.schedule.scheduled_days,
    stability: card.schedule.stability,
    difficulty: card.schedule.difficulty,
    lapses: card.schedule.lapses,
    reps: card.schedule.reps,
    due: Math.ceil((Date.parse(card.schedule.due) - now) / 86_400_000),
  };
  return compare(numeric[field] ?? NaN, value);
}
export const isStructuredStudyQuery = (query: string): boolean =>
  /(?:[a-z]+:|\b(?:AND|OR|NOT)\b|[()"]|(?:^|\s)-\S)/.test(query);

export function validateStudyQuery(query: unknown): Effect.Effect<StudyQuery, StudySearchFailure> {
  const parsed = parseStudyQuery(query);
  if (Either.isLeft(parsed)) return Effect.fail(parsed.left);
  const invalid = queryTerms(parsed.right).find((term) => !validTerm(term));
  if (invalid !== undefined)
    return Effect.fail({
      _tag: "StudySearchInvalid",
      message: `Unsupported search term: ${invalid}. Use tag:, deck:, is:, front:, back:, rated:, interval:, stability:, difficulty:, lapses:, reps:, due:, note:, card:, field:Name:value, or re:pattern. Regex supports anchors, character classes and one variable repetition anchored with ^; quote patterns containing spaces or parentheses.`,
    });
  return Effect.succeed(parsed.right);
}

export function searchStudyCards(
  workspace: Workspace,
  query: unknown,
  now: number,
  areaId?: string,
  index: StudySearchIndex = createStudySearchIndex(workspace),
): Effect.Effect<readonly StudyCardMatch[], StudySearchFailure> {
  const parsed = Effect.runSync(Effect.either(validateStudyQuery(query)));
  if (Either.isLeft(parsed)) return Effect.fail(parsed.left);
  if (!Number.isFinite(now))
    return Effect.fail({ _tag: "StudySearchInvalid", message: "The search time is invalid." });
  const expressions = new Map<string, RegExp>();
  for (const term of queryTerms(parsed.right)) {
    const { field, value } = splitTerm(term);
    const expression = field === "re" ? searchExpression(value) : undefined;
    if (expression) expressions.set(value, expression);
  }
  return Effect.succeed(
    index.entries.filter(
      (entry) =>
        (areaId === undefined || entry.area.id === areaId) &&
        matchesStudyQuery(parsed.right, (term) =>
          termMatches(
            term,
            entry,
            workspace,
            index.events.get(studyCardKey(entry)) ?? [],
            now,
            index.text.get(studyCardKey(entry)) ?? "",
            index,
            expressions,
          ),
        ),
    ),
  );
}
export const CARD_SEARCH_HELP =
  'Examples: tag:biology is:due · (is:new OR rated:7:again) -is:suspended · deck:"Cell biology" interval:>7 · field:Front:ATP · note:Basic · card:Reverse · re:"^What.*\\?$"';
