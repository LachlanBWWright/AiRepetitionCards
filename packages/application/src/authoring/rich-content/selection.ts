import type { RichInsertion } from "./index";

export type RichSelection = { readonly start: number; readonly end: number };
export type RichEdit = { readonly value: string; readonly selection: RichSelection };

/** Replace a selected range, or insert at the caret, with no platform dependencies. */
export function insertRichText(value: string, selection: RichSelection, text: string): RichEdit {
  const start = Math.max(0, Math.min(value.length, Math.trunc(selection.start)));
  const end = Math.max(start, Math.min(value.length, Math.trunc(selection.end)));
  return {
    value: value.slice(0, start) + text + value.slice(end),
    selection: { start: start + text.length, end: start + text.length },
  };
}

export function formatRichSelection(
  value: string,
  selection: RichSelection,
  kind: RichInsertion,
): RichEdit {
  const start = Math.max(0, Math.min(value.length, Math.trunc(selection.start)));
  const end = Math.max(start, Math.min(value.length, Math.trunc(selection.end)));
  const selected = value.slice(start, end);
  if (kind === "bullet" || kind === "number") {
    const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
    const nextNewline = value.indexOf("\n", Math.max(start, end - 1));
    const lineEnd = nextNewline < 0 ? value.length : nextNewline;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    const text = lines
      .map((line, index) => `${kind === "bullet" ? "-" : `${String(index + 1)}.`} ${line}`)
      .join("\n");
    const edit = insertRichText(value, { start: lineStart, end: lineEnd }, text);
    return { ...edit, selection: { start: lineStart, end: lineStart + text.length } };
  }
  const markers = { bold: "**", italic: "*", code: "`", math: "$", image: "" };
  const defaults = {
    bold: "bold text",
    italic: "italic text",
    code: "code",
    math: "E = mc^2",
    image: "![Description](media:ATTACHMENT_ID)",
  };
  const marker = markers[kind];
  const content = selected || defaults[kind];
  const edit = insertRichText(value, { start, end }, marker + content + marker);
  return {
    ...edit,
    selection: { start: start + marker.length, end: start + marker.length + content.length },
  };
}
