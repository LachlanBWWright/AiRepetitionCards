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
      readonly answer: string;
      readonly hint: string | undefined;
    };

function failure(reason: ClozeFailure["reason"]): ClozeFailure {
  return { _tag: "ClozeFailure", reason };
}

function parse(text: unknown): Effect.Effect<readonly Segment[], ClozeFailure> {
  if (typeof text !== "string" || text.trim().length === 0) {
    return Effect.fail(failure("invalid-text"));
  }
  if (text.length > MAX_CLOZE_TEXT_LENGTH) return Effect.fail(failure("text-too-long"));
  const segments: Segment[] = [];
  const pattern = /\{\{c([1-9]|1[0-9]|20)::([^{}]+?)\}\}/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const prefix = text.slice(offset, match.index);
    if (prefix.includes("{{") || prefix.includes("}}")) {
      return Effect.fail(failure("malformed-deletion"));
    }
    const contents = match[2] ?? "";
    const separator = contents.indexOf("::");
    const answer = separator < 0 ? contents : contents.slice(0, separator);
    const hint = separator < 0 ? undefined : contents.slice(separator + 2);
    if (!answer.trim() || (hint !== undefined && (!hint.trim() || hint.includes("::")))) {
      return Effect.fail(failure("malformed-deletion"));
    }
    segments.push({ kind: "text", text: prefix });
    segments.push({ kind: "deletion", index: Number(match[1]), answer, hint });
    offset = match.index + match[0].length;
  }
  const suffix = text.slice(offset);
  if (suffix.includes("{{") || suffix.includes("}}")) {
    return Effect.fail(failure("malformed-deletion"));
  }
  if (!segments.some((segment) => segment.kind === "deletion")) {
    return Effect.fail(failure("no-deletions"));
  }
  segments.push({ kind: "text", text: suffix });
  return Effect.succeed(segments);
}

/** Render one selected deletion, or all distinct deletion indices in ascending order. */
export function expandCloze(
  text: unknown,
  deletionIndex?: unknown,
): Effect.Effect<readonly RenderedCloze[], ClozeFailure> {
  return Effect.gen(function* () {
    const segments = yield* parse(text);
    const indices = [
      ...new Set(
        segments.flatMap((segment) => (segment.kind === "deletion" ? [segment.index] : [])),
      ),
    ].sort((left, right) => left - right);
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
      text: segments
        .map((segment) =>
          segment.kind === "text"
            ? segment.text
            : `{{c${String(segment.index)}::${segment.answer}${segment.hint === undefined ? "" : `::${segment.hint}`}}}`,
        )
        .join(""),
      deletionIndex: index,
      front: segments
        .map((segment) =>
          segment.kind === "text"
            ? segment.text
            : segment.index === index
              ? `[${segment.hint ?? "..."}]`
              : segment.answer,
        )
        .join(""),
      back: segments
        .map((segment) => (segment.kind === "text" ? segment.text : segment.answer))
        .join(""),
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
