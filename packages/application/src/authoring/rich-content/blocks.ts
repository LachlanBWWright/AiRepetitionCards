import type { RichBlock } from "./types";
import { parseRichInline } from "./inline";
import { closingToken, codeSpan, escapedAt } from "./tokens";

export function parseRichContent(text: string): readonly RichBlock[] {
  const blocks: RichBlock[] = [];
  let offset = 0;
  let cursor = 0;
  const flush = (end: number) => {
    const before = text.slice(offset, end).replace(/\n$/, "");
    if (before) blocks.push(...parseTextBlocks(before));
  };
  while (cursor < text.length) {
    const lineStart = cursor === 0 || text[cursor - 1] === "\n";
    const fence = lineStart ? /^ {0,3}(`{3,}|~{3,})([^\n]*)\n/.exec(text.slice(cursor)) : null;
    if (fence) {
      const marker = fence[1] ?? "```";
      const bodyStart = cursor + fence[0].length;
      const ending = new RegExp(
        `^ {0,3}${marker[0] === "`" ? "`" : "~"}{${String(marker.length)},}[ \\t]*(?:\\n|$)`,
        "gm",
      );
      ending.lastIndex = bodyStart;
      const end = ending.exec(text);
      flush(cursor);
      blocks.push({
        kind: "code",
        language: (fence[2] ?? "").trim().slice(0, 40),
        content: [
          {
            kind: "code",
            text: text.slice(bodyStart, end?.index ?? text.length).replace(/\n$/, ""),
          },
        ],
      });
      cursor = end ? end.index + end[0].length : text.length;
      offset = cursor;
      continue;
    }
    const code = codeSpan(text, cursor);
    if (code) {
      cursor = code.end;
      continue;
    }
    const marker = !escapedAt(text, cursor)
      ? text.startsWith("$$", cursor)
        ? "$$"
        : text.startsWith("\\[", cursor)
          ? "\\["
          : null
      : null;
    const closing = marker === "\\[" ? "\\]" : marker;
    const end = closing ? closingToken(text, closing, cursor + 2) : -1;
    if (marker && end >= 0) {
      flush(cursor);
      blocks.push({
        kind: "math",
        content: [{ kind: "math", text: text.slice(cursor + 2, end).trim() }],
      });
      cursor = end + 2;
      if (text[cursor] === "\n") cursor++;
      offset = cursor;
      continue;
    }
    cursor++;
  }
  if (offset < text.length || !blocks.length) blocks.push(...parseTextBlocks(text.slice(offset)));
  return blocks;
}
function parseTextBlocks(text: string): readonly RichBlock[] {
  return text.split("\n").map((line) => {
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^(\d{1,3})\.\s+(.+)$/.exec(line);
    if (heading) return { kind: "heading", content: parseRichInline(heading[1] ?? "") };
    if (quote) return { kind: "quote", content: parseRichInline(quote[1] ?? "") };
    if (bullet) return { kind: "bullet", content: parseRichInline(bullet[1] ?? "") };
    if (numbered)
      return {
        kind: "number",
        number: Number(numbered[1]),
        content: parseRichInline(numbered[2] ?? ""),
      };
    return { kind: "paragraph", content: parseRichInline(line) };
  });
}
