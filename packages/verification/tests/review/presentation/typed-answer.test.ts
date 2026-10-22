import assert from "node:assert/strict";
import test from "node:test";
import { Schema, Either } from "effect";
import { compareTypedAnswer } from "@recall/application";
import { ReviewPresentationSchema } from "@recall/domain";
const settings = { enabled: true, ignoreCase: true, ignoreAccents: false };
void test("typing comparison normalizes canonical Unicode and whitespace without hiding accents", () => {
  assert.equal(
    compareTypedAnswer("  CAFÉ  au\n lait ", "cafe\u0301 au lait", settings).matches,
    true,
  );
  assert.equal(compareTypedAnswer("cafe", "café", settings).matches, false);
  assert.equal(
    compareTypedAnswer("cafe", "café", { ...settings, ignoreAccents: true }).matches,
    true,
  );
  assert.equal(
    compareTypedAnswer("Cafe", "cafe", { ...settings, ignoreCase: false }).matches,
    false,
  );
});
void test("typing diff retains expected missing words and erroneous actual words", () => {
  const comparison = compareTypedAnswer("red small bird", "red big bird", settings);
  assert.equal(comparison.matches, false);
  assert.deepEqual(comparison.differences, [
    { kind: "equal", text: "red" },
    { kind: "extra", text: "small" },
    { kind: "missing", text: "big" },
    { kind: "equal", text: "bird" },
  ]);
  assert.equal(compareTypedAnswer("", "answer", settings).matches, false);
});
void test("long answers use a bounded diff while punctuation remains significant", () => {
  const result = compareTypedAnswer("word ".repeat(201), "word ".repeat(202), settings);
  assert.equal(result.differences.length, 2);
  assert.equal(compareTypedAnswer("hello", "hello!", settings).matches, false);
});
void test("presentation schema validates untrusted speed and typing options", () => {
  assert.equal(
    Either.isRight(
      Schema.decodeUnknownEither(ReviewPresentationSchema)({
        typedAnswer: settings,
        speech: { back: { language: "fr-FR", rate: 0.75, autoplay: true } },
      }),
    ),
    true,
  );
  assert.equal(
    Either.isLeft(
      Schema.decodeUnknownEither(ReviewPresentationSchema)({
        speech: { back: { language: "", rate: 9, autoplay: true } },
      }),
    ),
    true,
  );
});
