import { Effect } from "effect";

export const MAX_CLOZE_TEXT_LENGTH = 20_000;

export type ClozeFailure = {
  readonly _tag: "ClozeFailure";
  readonly reason:
    | "invalid-text"
    | "text-too-long"
    | "malformed-deletion"
    | "no-deletions"
    | "invalid-deletion-index"
    | "missing-deletion-index";
};

export type RenderedCloze = {
  readonly text: string;
  readonly deletionIndex: number;
  readonly front: string;
  readonly back: string;
};

type Segment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "deletion";
      readonly index: number;
      readonly children: readonly Segment[];
      readonly hint?: string;
    };

function failure(reason: ClozeFailure["reason"]): ClozeFailure {
  return { _tag: "ClozeFailure", reason };
}

type ParseResult = {
  readonly segments: readonly Segment[];
  readonly offset: number;
  readonly hint?: string;
};
function parseSegments(
  text: string,
  start: number,
  nested: boolean,
  depth: number,
): ParseResult | undefined {
  if (depth > 8) return undefined;
  const segments: Segment[] = [];
  let offset = start;
  let literal = "";
  while (offset < text.length) {
    if (text.startsWith("}}", offset) || (nested && text.startsWith("::", offset))) {
      if (!nested) return undefined;
      if (literal) segments.push({ kind: "text", text: literal });
      if (segments.length === 0) return undefined;
      if (text.startsWith("}}", offset)) return { segments, offset: offset + 2 };
      const end = text.indexOf("}}", offset + 2);
      const hint = text.slice(offset + 2, end);
      return end < 0 || !hint.trim() || hint.includes("{{") || hint.includes("::")
        ? undefined
        : { segments, offset: end + 2, hint };
    }
    if (text.startsWith("{{", offset)) {
      const header = /^\{\{c([1-9]|1[0-9]|20)::/.exec(text.slice(offset));
      if (!header) return undefined;
      if (literal) segments.push({ kind: "text", text: literal });
      literal = "";
      const child = parseSegments(text, offset + header[0].length, true, depth + 1);
      if (!child || !renderSegments(child.segments).trim()) return undefined;
      segments.push({
        kind: "deletion",
        index: Number(header[1]),
        children: child.segments,
        ...(child.hint === undefined ? {} : { hint: child.hint }),
      });
      offset = child.offset;
    } else {
      literal += text.charAt(offset);
      offset += 1;
    }
  }
  if (nested) return undefined;
  if (literal) segments.push({ kind: "text", text: literal });
  return { segments, offset };
}
function renderSegments(segments: readonly Segment[], index?: number): string {
  return segments
    .map((segment) =>
      segment.kind === "text"
        ? segment.text
        : segment.index === index
          ? `[${segment.hint ?? "..."}]`
          : renderSegments(segment.children, index),
    )
    .join("");
}
function deletionIndices(segments: readonly Segment[]): readonly number[] {
  return segments.flatMap((segment) =>
    segment.kind === "text" ? [] : [segment.index, ...deletionIndices(segment.children)],
  );
}
function parse(text: unknown): Effect.Effect<readonly Segment[], ClozeFailure> {
  if (typeof text !== "string" || !text.trim()) return Effect.fail(failure("invalid-text"));
  if (text.length > MAX_CLOZE_TEXT_LENGTH) return Effect.fail(failure("text-too-long"));
  const parsed = parseSegments(text, 0, false, 0);
  if (!parsed) return Effect.fail(failure("malformed-deletion"));
  return deletionIndices(parsed.segments).length === 0
    ? Effect.fail(failure("no-deletions"))
    : Effect.succeed(parsed.segments);
}

/** Render one selected deletion, or all distinct deletion indices in ascending order. */
export function expandCloze(
  text: unknown,
  deletionIndex?: unknown,
): Effect.Effect<readonly RenderedCloze[], ClozeFailure> {
  return Effect.gen(function* () {
    const segments = yield* parse(text);
    const indices = [...new Set(deletionIndices(segments))].sort((left, right) => left - right);
    if (
      deletionIndex !== undefined &&
      (typeof deletionIndex !== "number" ||
        !Number.isInteger(deletionIndex) ||
        deletionIndex < 1 ||
        deletionIndex > 20)
    ) {
      return yield* Effect.fail(failure("invalid-deletion-index"));
    }
    if (typeof deletionIndex === "number" && !indices.includes(deletionIndex)) {
      return yield* Effect.fail(failure("missing-deletion-index"));
    }
    const selected = typeof deletionIndex === "number" ? [deletionIndex] : indices;
    return selected.map((index) => ({
      text: typeof text === "string" ? text : "",
      deletionIndex: index,
      front: renderSegments(segments, index),
      back: renderSegments(segments),
    }));
  });
}

/** Render exactly one deletion for a study card or editor preview. */
export function renderCloze(
  text: unknown,
  deletionIndex: unknown,
): Effect.Effect<RenderedCloze, ClozeFailure> {
  if (deletionIndex === undefined) return Effect.fail(failure("invalid-deletion-index"));
  return expandCloze(text, deletionIndex).pipe(
    Effect.flatMap((cards) =>
      cards[0] ? Effect.succeed(cards[0]) : Effect.fail(failure("missing-deletion-index")),
    ),
  );
}

export const renderClozeCard = renderCloze;

function selectedAnswers(segments: readonly Segment[], index: number): readonly string[] {
  return segments.flatMap((segment) => {
    if (segment.kind === "text") return [];
    return segment.index === index
      ? [renderSegments(segment.children)]
      : selectedAnswers(segment.children, index);
  });
}

/** Answers hidden by the selected cloze; enclosing deletions contribute one complete answer. */
export function clozeAnswerText(input: unknown): Effect.Effect<string, ClozeFailure> {
  if (
    typeof input !== "object" ||
    input === null ||
    !("text" in input) ||
    !("deletionIndex" in input)
  )
    return Effect.fail(failure("invalid-text"));
  return Effect.gen(function* () {
    const rendered = yield* renderCloze(input.text, input.deletionIndex);
    const segments = yield* parse(rendered.text);
    return selectedAnswers(segments, rendered.deletionIndex).join(", ");
  });
}
