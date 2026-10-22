import type { TypedAnswerSettings } from "@recall/domain";

export type AnswerDifference = {
  readonly kind: "equal" | "missing" | "extra";
  readonly text: string;
};
export type AnswerComparison = {
  readonly matches: boolean;
  readonly differences: readonly AnswerDifference[];
};
export function normalizeTypedAnswer(text: string, settings: TypedAnswerSettings): string {
  const trimmed = text.normalize("NFC").trim().replace(/\s+/gu, " ");
  const accents = settings.ignoreAccents
    ? trimmed.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC")
    : trimmed;
  return settings.ignoreCase ? accents.toLowerCase() : accents;
}

/** Bounded word diff. Punctuation remains meaningful and ratings are always user-selected. */
export function compareTypedAnswer(
  actual: string,
  expected: string,
  settings: TypedAnswerSettings,
): AnswerComparison {
  const actualText = normalizeTypedAnswer(actual, settings);
  const expectedText = normalizeTypedAnswer(expected, settings);
  if (actualText === expectedText) {
    return { matches: true, differences: [{ kind: "equal", text: expectedText }] };
  }
  const left = actualText.split(" ");
  const right = expectedText.split(" ");
  if (left.length > 200 || right.length > 200) {
    return {
      matches: false,
      differences: [
        { kind: "extra", text: actualText },
        { kind: "missing", text: expectedText },
      ],
    };
  }
  const table = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      if (!row) continue;
      row[j] =
        left[i] === right[j]
          ? 1 + (table[i + 1]?.[j + 1] ?? 0)
          : Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0);
    }
  }
  const differences: AnswerDifference[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      differences.push({ kind: "equal", text: left[i] ?? "" });
      i += 1;
      j += 1;
    } else if (
      i < left.length &&
      (j >= right.length || (table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0))
    ) {
      differences.push({ kind: "extra", text: left[i] ?? "" });
      i += 1;
    } else {
      differences.push({ kind: "missing", text: right[j] ?? "" });
      j += 1;
    }
  }
  return { matches: false, differences };
}
