import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import type { LearningArea } from "@recall/domain";
import { Effect, Either, Schema } from "effect";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  exportDelimitedCards,
  exportKnowledgeAreaPackage,
  importDelimitedCards,
  importKnowledgeAreaPackage,
  toKnowledgeArea,
  type DelimitedImportError,
} from "@recall/application";

const now = new Date("2026-10-05T00:00:00.000Z");
function ids() {
  let counter = 0;
  return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}
function imported(text: string, delimiter: "," | "\t" = ",") {
  const result = importDelimitedCards(text, delimiter, "Imported", "#123456", now, ids());
  assert.ok(result._tag === "Success");
  return result.area;
}
function rejected(text: string, reason: DelimitedImportError) {
  const result = importDelimitedCards(text, ",", "Imported", "#123456", now, ids());
  assert.ok(result._tag === "Failure");
  assert.equal(result.reason, reason);
}
function success<A, E>(operation: Effect.Effect<A, E>) {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}

void test("CSV accepts a BOM before quoted headers and retains quoted CRLF, delimiters and escapes", () => {
  const area = imported(
    '\uFEFF"front","back"\r\n"Question, with ""quotes""\r\nand 日本語","Answer\t🧠"\r\n',
  );
  assert.ok(area.cards[0]);
  assert.equal(area.cards[0].front, 'Question, with "quotes"\r\nand 日本語');
  assert.equal(area.cards[0].back, "Answer\t🧠");
});

void test("seeded CSV and TSV round trips preserve embedded Unicode, quotes and line breaks", () => {
  const fragment = fc
    .array(fc.constantFrom("x", ",", "\t", "\r", "\n", '"', "日本語", "🧠", "e\u0301"), {
      maxLength: 35,
    })
    .map((parts) => parts.join(""));
  fc.assert(
    fc.property(
      fragment,
      fragment,
      fc.constantFrom("," as const, "\t" as const),
      (front, back, delimiter) => {
        const original = imported("front,back\nQ,A");
        const card = original.cards[0];
        assert.ok(card);
        const expected = { front: `Q ${front} end`, back: `A ${back} end` };
        const exported = exportDelimitedCards(
          { ...original, cards: [{ ...card, ...expected }] },
          delimiter,
        );
        const actual = imported(exported, delimiter).cards[0];
        assert.ok(actual);
        assert.equal(actual.front, expected.front);
        assert.equal(actual.back, expected.back);
      },
    ),
    { seed: 10501, numRuns: 120 },
  );
});

void test("spreadsheet escaping covers padded formulas on both card sides and objective names", () => {
  const original = imported("front,back\nQ,A");
  const card = original.cards[0];
  assert.ok(card);
  for (const prefix of ["=", "+", "-", "@", " \t=", "\r@"])
    for (const delimiter of [",", "\t"] as const) {
      const value = `${prefix}DANGEROUS(日本語)`;
      const actual: LearningArea["cards"][number] | undefined = imported(
        exportDelimitedCards(
          { ...original, cards: [{ ...card, front: value, back: value, objective: value }] },
          delimiter,
        ),
        delimiter,
      ).cards[0];
      assert.ok(actual);
      assert.equal(actual.front, `'${value}`);
      assert.equal(actual.back, `'${value}`);
      assert.equal(actual.objective, `'${value}`);
    }
});

void test("quote closure and mid-field quotes fail consistently rather than accepting ambiguous cells", () => {
  for (const record of ['"Q" trailing,A', 'pre"Q",A', '"Q" "extra",A', '"Q"\t,A'])
    rejected(`front,back\n${record}`, "invalid-quote");
});

void test("column limit allows thirty columns and rejects the thirty-first in both row positions", () => {
  const header = [
    "front",
    "back",
    ...Array.from({ length: 28 }, (_, index) => `unused${String(index)}`),
  ].join(",");
  const row = ["Q", "A", ...Array.from({ length: 28 }, () => "x")].join(",");
  assert.equal(imported(`${header}\n${row}`).cards.length, 1);
  rejected(`${header},extra\n${row}`, "too-many-columns");
  rejected(`${header}\n${row},extra`, "too-many-columns");
});

void test("empty rows do not count toward the 500-card bound but populated rows do", () => {
  const rows = Array.from({ length: 500 }, (_, index) => `Question ${String(index)},Answer`);
  assert.equal(imported(`\n,\r\nfront,back\r\n${rows.join("\r\n,,\r\n")}\r\n`).cards.length, 500);
  rejected(`front,back\n${[...rows, "Extra,Answer"].join("\n")}`, "too-many-rows");
});

void test("field and aggregate input limits reject oversized quoted and unquoted strings", () => {
  rejected(`front,back\n${"x".repeat(1_000_001)},A`, "field-too-large");
  rejected(`front,back\n"${"x".repeat(1_000_001)}",A`, "field-too-large");
  rejected("x".repeat(2_000_001), "input-too-large");
});

void test("missing values, unusable metadata and invalid timestamps fail before identity allocation", () => {
  for (const text of ["front,back\nQ,", "front,back\n,A", "front\nQ", "back\nA"])
    rejected(text, "missing-front-back");
  for (const [title, color, date, reason] of [
    ["x".repeat(81), "#123456", now, "invalid-metadata"],
    ["Title", "red", now, "invalid-metadata"],
    ["Title", "#123456", new Date(NaN), "invalid-timestamp"],
  ] as const) {
    let calls = 0;
    const result = importDelimitedCards("Q,A", ",", title, color, date, () => {
      calls += 1;
      return ids()();
    });
    assert.ok(result._tag === "Failure");
    assert.equal(result.reason, reason);
    assert.equal(calls, 0);
  }
});

void test("canonical packages reject duplicate manifest identities even when the archive itself is unique", () => {
  const area = imported("front,back\nQ,A");
  const portable = success(toKnowledgeArea(area));
  const archive = success(
    exportKnowledgeAreaPackage(portable, {
      get: () => Effect.succeed(null),
      put: () => Effect.void,
      delete: () => Effect.void,
      list: Effect.succeed([]),
    }),
  );
  const files = unzipSync(archive);
  const raw = files["manifest.json"];
  assert.ok(raw);
  const manifest = success(
    Schema.decodeUnknown(
      Schema.parseJson(
        Schema.Struct({
          formatVersion: Schema.Number,
          exporter: Schema.String,
          files: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String })),
          media: Schema.Array(Schema.Unknown),
        }),
      ),
    )(strFromU8(raw)),
  );
  const first = manifest.files[0];
  assert.ok(first);
  for (const changed of [
    { ...manifest, files: [first, first, ...manifest.files.slice(2)] },
    { ...manifest, formatVersion: 999 },
    { ...manifest, files: manifest.files.slice(1) },
    { ...manifest, files: [...manifest.files, { path: "manifest.json", sha256: first.sha256 }] },
  ]) {
    const result = Effect.runSync(
      Effect.either(
        importKnowledgeAreaPackage(
          zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(changed)) }, { level: 0 }),
        ),
      ),
    );
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.reason, "invalid-package");
  }
});
