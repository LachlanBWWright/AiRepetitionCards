import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  LearningAreaSchema,
  type LearningArea,
} from "@recall/domain";
import { Effect, Either, Schema } from "effect";
import { toKnowledgeArea } from "./knowledge-area-interchange";
import { newSchedule } from "@recall/scheduler";

type DelimitedRow = readonly string[];
type Delimiter = "," | "\t";

export type DelimitedImportError =
  | "invalid-timestamp"
  | "invalid-quote"
  | "too-many-rows"
  | "too-many-columns"
  | "field-too-large"
  | "input-too-large"
  | "missing-front-back"
  | "no-cards"
  | "too-many-cards"
  | "too-many-objectives"
  | "invalid-metadata"
  | "invalid-content"
  | "invalid-tag-encoding"
  | "identity-unavailable";

export type DelimitedImportResult =
  | { readonly _tag: "Success"; readonly area: LearningArea }
  | { readonly _tag: "Failure"; readonly reason: DelimitedImportError };

const MAX_INPUT_CHARACTERS = 2_000_000;
const MAX_FIELD_CHARACTERS = 1_000_000;
const MAX_ROWS = 501;
const MAX_COLUMNS = 30;
// Imported canonical content may contain empty or longer tags than newly authored cards.
const EncodedTagsSchema = Schema.Array(Schema.String);

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
  now: Date,
  createId: () => string = () => crypto.randomUUID(),
): DelimitedImportResult {
  if (!Number.isFinite(now.getTime())) return { _tag: "Failure", reason: "invalid-timestamp" };
  const importedTitle = title.trim() || "Imported cards";
  if (importedTitle.length > 80 || !/^#[0-9a-fA-F]{6}$/.test(color))
    return { _tag: "Failure", reason: "invalid-metadata" };
  const parsed = parseRows(text.startsWith("\uFEFF") ? text.slice(1) : text, delimiter);
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
  const tagsJsonIndex = hasHeader ? headers.findIndex((header) => header === "tagsjson") : -1;
  if (frontIndex < 0 || backIndex < 0) return { _tag: "Failure", reason: "missing-front-back" };

  const records = hasHeader ? remaining : parsed.rows;
  const preparedRecords = Effect.runSync(
    Effect.either(
      Effect.forEach(records, (record) =>
        Effect.gen(function* () {
          const front = record[frontIndex]?.trim() ?? "";
          const back = record[backIndex]?.trim() ?? "";
          if (!front || !back) return yield* Effect.fail({ _tag: "DelimitedRowInvalid" } as const);
          const objective = record[objectiveIndex]?.trim() || "Imported cards";
          const tags =
            tagsJsonIndex >= 0
              ? Schema.decodeUnknown(Schema.parseJson(EncodedTagsSchema))(
                  record[tagsJsonIndex] || "[]",
                ).pipe(Effect.mapError(() => ({ _tag: "DelimitedTagsInvalid" }) as const))
              : Effect.succeed(
                  (record[tagsIndex] ?? "")
                    .split(/[|;]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                );
          const parsedTags = yield* tags;
          return [{ front, back, objective, tags: parsedTags }];
        }),
      ),
    ),
  );
  if (Either.isLeft(preparedRecords))
    return {
      _tag: "Failure",
      reason:
        preparedRecords.left._tag === "DelimitedRowInvalid"
          ? "missing-front-back"
          : "invalid-tag-encoding",
    };
  const generatedCards = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () =>
          preparedRecords.right.flat().map((record) => ({
            ...record,
            id: createAssessmentId(createId()),
            origin: "imported" as const,
            schedule: newSchedule(now),
          })),
        catch: () => ({ _tag: "DelimitedIdentityUnavailable" }) as const,
      }),
    ),
  );
  if (Either.isLeft(generatedCards)) return { _tag: "Failure", reason: "identity-unavailable" };
  const cards = generatedCards.right;
  if (cards.length === 0) return { _tag: "Failure", reason: "no-cards" };

  if (cards.length > 500) return { _tag: "Failure", reason: "too-many-cards" };
  const objectiveTitles = [...new Set(cards.map((card) => card.objective))];
  if (objectiveTitles.length > 200) return { _tag: "Failure", reason: "too-many-objectives" };
  const generatedArea = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => {
          const objectiveIdByTitle = new Map(
            objectiveTitles.map((objective) => [objective, createObjectiveId(createId())]),
          );
          return {
            id: createAreaId(createId()),
            title: importedTitle,
            color,
            cards: cards.map((card) => ({
              ...card,
              objectiveIds: [
                objectiveIdByTitle.get(card.objective) ?? createObjectiveId(card.objective),
              ],
            })),
            objectives: objectiveTitles.map((objective) => ({
              id: objectiveIdByTitle.get(objective) ?? createObjectiveId(objective),
              title: objective,
              description: null,
              prerequisiteIds: [],
            })),
            language: "en",
            tags: [],
            licence: null,
          };
        },
        catch: () => ({ _tag: "DelimitedIdentityUnavailable" }) as const,
      }),
    ),
  );
  if (Either.isLeft(generatedArea)) return { _tag: "Failure", reason: "identity-unavailable" };
  const decoded = Schema.decodeUnknownEither(LearningAreaSchema)(generatedArea.right);
  if (Either.isLeft(decoded)) return { _tag: "Failure", reason: "invalid-content" };
  const portable = Effect.runSync(Effect.either(toKnowledgeArea(decoded.right)));
  return Either.isLeft(portable)
    ? { _tag: "Failure", reason: "invalid-content" }
    : { _tag: "Success", area: decoded.right };
}

/** Keep a readable legacy tags column and an authoritative JSON column for lossless tag text. */
export function exportDelimitedCards(area: LearningArea, delimiter: Delimiter): string {
  const rows = [
    ["front", "back", "objective", "tags", "tags_json"],
    ...area.cards.map((card) => [
      card.front,
      card.back,
      card.objective,
      card.tags?.join(" | ") ?? "",
      JSON.stringify(card.tags ?? []),
    ]),
  ];
  return rows.map((row) => row.map((cell) => quote(cell, delimiter)).join(delimiter)).join("\r\n");
}
