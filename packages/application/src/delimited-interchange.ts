import type { LearningArea } from "@recall/domain";
import { newSchedule } from "@recall/scheduler";

type DelimitedRow = readonly string[];
type Delimiter = "," | "\t";

export type DelimitedImportError =
  | "invalid-quote"
  | "too-many-rows"
  | "too-many-columns"
  | "field-too-large"
  | "input-too-large"
  | "missing-front-back"
  | "no-cards";

export type DelimitedImportResult =
  | { readonly _tag: "Success"; readonly area: LearningArea }
  | { readonly _tag: "Failure"; readonly reason: DelimitedImportError };

const MAX_INPUT_CHARACTERS = 2_000_000;
const MAX_FIELD_CHARACTERS = 1_000_000;
const MAX_ROWS = 10_001;
const MAX_COLUMNS = 30;

function parseRows(
  text: string,
  delimiter: Delimiter,
):
  | { readonly _tag: "Success"; readonly rows: readonly DelimitedRow[] }
  | { readonly _tag: "Failure"; readonly reason: DelimitedImportError } {
  if (text.length > MAX_INPUT_CHARACTERS) return { _tag: "Failure", reason: "input-too-large" };
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) continue;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      if (field.length > MAX_FIELD_CHARACTERS)
        return { _tag: "Failure", reason: "field-too-large" };
      continue;
    }
    if (closedQuote && character !== delimiter && character !== "\n" && character !== "\r")
      return { _tag: "Failure", reason: "invalid-quote" };
    if (character === '"') {
      if (field.length > 0) return { _tag: "Failure", reason: "invalid-quote" };
      quoted = true;
      continue;
    }
    if (character === delimiter) {
      row.push(field);
      field = "";
      closedQuote = false;
      if (row.length >= MAX_COLUMNS) return { _tag: "Failure", reason: "too-many-columns" };
      continue;
    }
    if (character === "\n" || character === "\r") {
      row.push(field);
      if (row.length > MAX_COLUMNS) return { _tag: "Failure", reason: "too-many-columns" };
      field = "";
      if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
      row = [];
      closedQuote = false;
      if (rows.length > MAX_ROWS) return { _tag: "Failure", reason: "too-many-rows" };
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      continue;
    }
    field += character;
    if (field.length > MAX_FIELD_CHARACTERS) return { _tag: "Failure", reason: "field-too-large" };
  }

  if (quoted) return { _tag: "Failure", reason: "invalid-quote" };
  row.push(field);
  if (row.length > MAX_COLUMNS) return { _tag: "Failure", reason: "too-many-columns" };
  if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
  if (rows.length > MAX_ROWS) return { _tag: "Failure", reason: "too-many-rows" };
  return { _tag: "Success", rows };
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, "");
}

function spreadsheetSafe(value: string): string {
  return /^[\t\r ]*[=+@-]/.test(value) ? `'${value}` : value;
}

function quote(value: string, delimiter: Delimiter): string {
  const safe = spreadsheetSafe(value);
  return safe.includes(delimiter) || /["\r\n]/.test(safe)
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
}

/** Imports CSV or TSV text using bounded parsing and explicit, expected failure tags. */
export function importDelimitedCards(
  text: string,
  delimiter: Delimiter,
  title: string,
  color: string,
): DelimitedImportResult {
  const parsed = parseRows(text, delimiter);
  if (parsed._tag === "Failure") return parsed;
  const [first, ...remaining] = parsed.rows;
  if (!first) return { _tag: "Failure", reason: "no-cards" };

  const headers = first.map(normalizeHeader);
  const frontHeaders = new Set(["front", "question", "prompt"]);
  const backHeaders = new Set(["back", "answer", "response"]);
  const hasHeader = headers.some((header) => frontHeaders.has(header) || backHeaders.has(header));
  const frontIndex = hasHeader ? headers.findIndex((header) => frontHeaders.has(header)) : 0;
  const backIndex = hasHeader ? headers.findIndex((header) => backHeaders.has(header)) : 1;
  const objectiveIndex = hasHeader
    ? headers.findIndex((header) => header === "objective" || header === "learningobjective")
    : -1;
  const tagsIndex = hasHeader
    ? headers.findIndex((header) => header === "tags" || header === "tag")
    : -1;
  if (frontIndex < 0 || backIndex < 0) return { _tag: "Failure", reason: "missing-front-back" };

  const records = hasHeader ? remaining : parsed.rows;
  const cards = records.flatMap((record) => {
    const front = record[frontIndex]?.trim() ?? "";
    const back = record[backIndex]?.trim() ?? "";
    if (!front || !back) return [];
    const objective = record[objectiveIndex]?.trim() || "Imported cards";
    const tags = (record[tagsIndex] ?? "")
      .split(/[|;]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    return [
      {
        id: crypto.randomUUID(),
        front,
        back,
        objective,
        tags,
        origin: "imported" as const,
        schedule: newSchedule(),
      },
    ];
  });
  if (cards.length === 0) return { _tag: "Failure", reason: "no-cards" };

  const objectiveTitles = [...new Set(cards.map((card) => card.objective))];
  const objectiveIdByTitle = new Map(
    objectiveTitles.map((objective) => [objective, crypto.randomUUID()]),
  );
  return {
    _tag: "Success",
    area: {
      id: crypto.randomUUID(),
      title: title.trim() || "Imported cards",
      color,
      cards: cards.map((card) => ({
        ...card,
        objectiveIds: [objectiveIdByTitle.get(card.objective) ?? ""],
      })),
      objectives: objectiveTitles.map((objective) => ({
        id: objectiveIdByTitle.get(objective) ?? "",
        title: objective,
        description: null,
        prerequisiteIds: [],
      })),
      language: "en",
      tags: [],
      licence: null,
    },
  };
}

/** Exports CSV or TSV with formula-leading cells escaped for spreadsheet safety. */
export function exportDelimitedCards(area: LearningArea, delimiter: Delimiter): string {
  const rows = [
    ["front", "back", "objective", "tags"],
    ...area.cards.map((card) => [
      card.front,
      card.back,
      card.objective,
      card.tags?.join(" | ") ?? "",
    ]),
  ];
  return rows.map((row) => row.map((cell) => quote(cell, delimiter)).join(delimiter)).join("\r\n");
}
