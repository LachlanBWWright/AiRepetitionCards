import { renderNoteTemplate } from "../../notes/template-render";
import { Either, Schema } from "effect";
import type { AnkiCardRow, AnkiNoteType } from "./anki-import-contracts";

const Templates = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    qfmt: Schema.String.pipe(Schema.maxLength(500_000)),
    afmt: Schema.String.pipe(Schema.maxLength(500_000)),
  }),
).pipe(Schema.maxItems(100));

/** Decode model templates without evaluating imported HTML, scripts, or template code. */
export function decodeAnkiTemplates(value: unknown): AnkiNoteType["templates"] {
  const decoded = Schema.decodeUnknownEither(Templates)(value);
  return Either.isRight(decoded)
    ? decoded.right.map((template) => ({
        name: template.name,
        front: template.qfmt,
        back: template.afmt,
      }))
    : undefined;
}

/** Legacy day-based review due dates are relative to col.crt, not the import date. */
export function decodeAnkiScheduling(
  row: Readonly<Record<string, unknown>>,
  created: unknown,
): AnkiCardRow["scheduling"] {
  const { due, ivl, reps, lapses, type, queue } = row;
  if (typeof row.odid === "number" && row.odid !== 0) return undefined;
  if (
    ![due, ivl, reps, lapses, type, queue, created].every(
      (value) => typeof value === "number" && Number.isSafeInteger(value),
    )
  )
    return undefined;
  if (
    typeof due !== "number" ||
    typeof ivl !== "number" ||
    typeof reps !== "number" ||
    typeof lapses !== "number" ||
    typeof type !== "number" ||
    typeof queue !== "number" ||
    typeof created !== "number"
  )
    return undefined;
  // Suspended/buried cards retain their underlying type. Day-learning uses collection days.
  if (queue < -3 || queue > 3 || type < 0 || type > 3 || reps < 0 || lapses < 0 || ivl < 0)
    return undefined;
  const timestamp =
    type === 0
      ? created * 1000
      : queue === 1 || (queue < 0 && (type === 1 || type === 3) && due > 1_000_000_000)
        ? due * 1000
        : (created + due * 86400) * 1000;
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8_640_000_000_000_000) return undefined;
  const memory = decodeMemory(row.data);
  return {
    ...memory,
    ...(queue === -1 ? { suspended: true } : {}),
    due: new Date(timestamp).toISOString(),
    interval: ivl,
    reps,
    lapses,
    state: type === 0 ? 0 : type === 1 ? 1 : type === 3 ? 3 : 2,
  };
}

/** Static fields, FrontSide and bounded conditional sections are accepted; executable code is rejected. */
export function renderAnkiTemplate(
  template: string,
  fields: ReadonlyMap<string, string>,
  front = "",
): string | undefined {
  if (/<\s*(script|iframe|object|embed)\b|\bon\w+\s*=|javascript:/i.test(template))
    return undefined;
  const values = Object.fromEntries([...fields, ["frontside", front]]);
  const normalized = template.replace(
    /\{\{([^{}]+)\}\}/g,
    (_match, token: string) => `{{${token.toLowerCase()}}}`,
  );
  return renderNoteTemplate(normalized, values, new Set(Object.keys(values)));
}

/** Bounded decoding of Anki's documented cards.data memory fields; custom code is ignored. */
function decodeMemory(input: unknown): {
  readonly stability?: number;
  readonly difficulty?: number;
  readonly lastReview?: string;
} {
  if (typeof input !== "string" || input.length > 100_000) return {};
  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const data = value as Readonly<Record<string, unknown>>;
  const memory =
    typeof data.s === "number" &&
    Number.isFinite(data.s) &&
    data.s > 0 &&
    typeof data.d === "number" &&
    Number.isFinite(data.d) &&
    data.d >= 1 &&
    data.d <= 10
      ? { stability: data.s, difficulty: data.d }
      : {};
  return typeof data.lrt === "number" &&
    Number.isSafeInteger(data.lrt) &&
    data.lrt > 0 &&
    data.lrt <= 8_640_000_000_000
    ? { ...memory, lastReview: new Date(data.lrt * 1000).toISOString() }
    : memory;
}
