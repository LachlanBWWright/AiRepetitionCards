import type { RichInline } from "./types";
import { closingToken, codeSpan, escapedAt } from "./tokens";

export function parseRichInline(text: string): readonly RichInline[] {
  const result: RichInline[] = [];
  let plain = "";
  const push = (item: RichInline) => {
    if (plain) result.push({ kind: "text", text: plain });
    plain = "";
    result.push(item);
  };
  let cursor = 0;
  while (cursor < text.length) {
    const code = codeSpan(text, cursor);
    if (code) {
      push({ kind: "code", text: code.text });
      cursor = code.end;
      continue;
    }
    if (text[cursor] === "\\" && /[\\$*`]/.test(text[cursor + 1] ?? "")) {
      plain += text.charAt(cursor + 1);
      cursor += 2;
      continue;
    }
    const rest = text.slice(cursor);
    const image = /^!\[([^\]\n]{0,200})\]\(media:([a-zA-Z0-9_-]{1,160})\)/.exec(rest);
    if (image) {
      push({ kind: "image", text: image[1] ?? "", mediaId: image[2] ?? "" });
      cursor += image[0].length;
      continue;
    }
    const marker = rest.startsWith("\\(")
      ? "\\("
      : rest.startsWith("**")
        ? "**"
        : rest[0] === "*"
          ? "*"
          : rest[0] === "$" && !rest.startsWith("$$")
            ? "$"
            : null;
    const closing = marker === "\\(" ? "\\)" : marker;
    const end = closing ? closingToken(text, closing, cursor + (marker?.length ?? 0)) : -1;
    const content = marker && end >= 0 ? text.slice(cursor + marker.length, end) : "";
    const money =
      marker === "$" &&
      (/^\s/.test(content) ||
        /\s$/.test(content) ||
        /^\d[\d,.]*[\s;:!?]/.test(content) ||
        /\d/.test(text[end + 1] ?? ""));
    if (
      marker &&
      end >= 0 &&
      content &&
      !content.includes("\n") &&
      !content.includes("`") &&
      !money &&
      !escapedAt(text, cursor)
    ) {
      push({
        kind: marker === "**" ? "strong" : marker === "*" ? "emphasis" : "math",
        text: content,
      });
      cursor = end + (closing?.length ?? 0);
      continue;
    }
    plain += text.charAt(cursor);
    cursor++;
  }
  if (plain) result.push({ kind: "text", text: plain });
  return result;
}
