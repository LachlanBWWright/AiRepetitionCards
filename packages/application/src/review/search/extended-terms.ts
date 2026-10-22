import { Either } from "effect";
import type { StudyCardMatch } from "./card-search";
import { normalizeSearchText } from "./search-index";

/** Bounded regular expressions exclude backtracking groups, alternation and backreferences. */
export function searchExpression(pattern: string): RegExp | undefined {
  if (pattern.length > 120 || /[()|{}]|\\[1-9]|\[\^?\]|(?:[+*?]){2}/.test(pattern))
    return undefined;
  // At most one variable repetition prevents polynomial backtracking on long authored fields.
  const repetitions = (pattern.match(/(?<!\\)[*+?]/g) ?? []).length;
  if (repetitions > 1 || (repetitions > 0 && !pattern.startsWith("^"))) return undefined;
  const parsed = Either.try(() => new RegExp(pattern, "iu"));
  return Either.isRight(parsed) ? parsed.right : undefined;
}
export function extendedTermValid(field: string, value: string): boolean | undefined {
  if (field === "note" || field === "card") return value.length > 0;
  if (field === "re") return searchExpression(value) !== undefined;
  if (field === "field") return value.indexOf(":") > 0;
  return undefined;
}
export function extendedTermMatches(
  field: string,
  value: string,
  entry: StudyCardMatch,
  source: import("./search-index").StudySearchIndex["sources"] extends ReadonlyMap<string, infer T>
    ? T | undefined
    : never,
  expression: RegExp | undefined,
): boolean | undefined {
  const { card } = entry;
  const note = source?.note;
  const type = source?.type;
  const normalized = normalizeSearchText(value);
  if (field === "note")
    return (
      type !== undefined && (normalizeSearchText(type.name) === normalized || type.id === value)
    );
  if (field === "card")
    return (
      type?.templates.some(
        (template) =>
          template.id === card.templateId &&
          (normalizeSearchText(template.name) === normalized || template.id === value),
      ) ?? false
    );
  if (field === "field") {
    const colon = value.indexOf(":");
    const name = normalizeSearchText(value.slice(0, colon));
    const expected = normalizeSearchText(value.slice(colon + 1));
    return Object.entries(note?.fields ?? {}).some(
      ([key, text]) =>
        normalizeSearchText(key) === name && normalizeSearchText(text).includes(expected),
    );
  }
  if (field === "re") {
    return (
      expression !== undefined &&
      [card.front, card.back, ...Object.values(note?.fields ?? {})].some((text) =>
        expression.test(text),
      )
    );
  }
  return undefined;
}
