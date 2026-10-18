import { Either } from "effect";

export type TagInputFailure = {
  readonly _tag: "TagInputFailure";
  readonly message: string;
};

const invalid = (): Either.Either<never, TagInputFailure> =>
  Either.left({
    _tag: "TagInputFailure",
    message:
      "Use comma-separated tags. Put tags containing commas inside double quotes, and double any quote inside a quoted tag.",
  });

/** Render an editable tag list without losing literal delimiters or imported whitespace. */
export function formatTagInput(tags: readonly string[]): string {
  return tags
    .map((tag) =>
      tag === "" || tag.trim() !== tag || /[,"\r\n]/.test(tag)
        ? `"${tag.replaceAll('"', '""')}"`
        : tag,
    )
    .join(", ");
}

/** Parse one editable list; quoted fields preserve exact text, duplicates and empty tags. */
export function parseTagInput(input: unknown): Either.Either<readonly string[], TagInputFailure> {
  if (typeof input !== "string") return invalid();
  const tags: string[] = [];
  let index = 0;
  while (index < input.length) {
    while (index < input.length && input[index]?.trim() === "") index += 1;
    if (index >= input.length) break;
    if (input[index] === ",") {
      index += 1;
      continue;
    }
    if (input[index] === '"') {
      index += 1;
      let tag = "";
      let closed = false;
      while (index < input.length) {
        const character = input.charAt(index);
        if (character === '"') {
          if (input[index + 1] === '"') {
            tag += '"';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        tag += character;
        index += 1;
      }
      if (!closed) return invalid();
      while (index < input.length && input[index]?.trim() === "") index += 1;
      if (index < input.length && input[index] !== ",") return invalid();
      tags.push(tag);
    } else {
      const start = index;
      while (index < input.length && input[index] !== ",") {
        if (input[index] === '"') return invalid();
        index += 1;
      }
      const tag = input.slice(start, index).trim();
      if (tag !== "") tags.push(tag);
    }
    if (input[index] === ",") index += 1;
  }
  return Either.right(tags);
}

/** Canonical imported arrays may exceed authoring limits when left unchanged. */
export const tagsUnchanged = (tags: readonly string[], previous: readonly string[]): boolean =>
  tags.length === previous.length && tags.every((tag, index) => tag === previous[index]);

export const authoredTagsValid = (tags: readonly string[]): boolean =>
  tags.length <= 100 && tags.every((tag) => tag.trim().length > 0 && tag.length <= 80);
