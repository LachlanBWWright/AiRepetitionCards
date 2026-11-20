export type InteractiveActivityPresentation =
  | { readonly kind: "ordering"; readonly seed: number; readonly items: readonly InteractiveItem[] }
  | {
      readonly kind: "matching";
      readonly seed: number;
      readonly left: readonly InteractiveItem[];
      readonly right: readonly InteractiveItem[];
    }
  | { readonly kind: "code-tracing"; readonly code: string; readonly language: string };
export type InteractiveItem = { readonly id: string; readonly text: string };

export function shuffleInteractiveItems<T>(items: readonly T[], seed: number): readonly T[] {
  const shuffled = [...items];
  let state = seed >>> 0;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = state % (index + 1);
    const current = shuffled[index];
    const replacement = shuffled[target];
    if (current !== undefined && replacement !== undefined) {
      shuffled[index] = replacement;
      shuffled[target] = current;
    }
  }
  // An identity shuffle must never hand the learner the authored solution.
  return shuffled.length > 1 && shuffled.every((item, index) => item === items[index])
    ? [...shuffled.slice(1), ...shuffled.slice(0, 1)]
    : shuffled;
}
/** Preserve meaningful leading whitespace and case; tolerate platform newlines and trailing spaces. */
export function normalizeTracingOutput(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n+$/, "");
}

/** Stable mapping encoding independent of presentation order. Unknown/incomplete mappings are rejected at assessment. */
export function canonicalMatchingAnswer(mapping: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(mapping).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
  );
}
