export * from "./selection";
export * from "./appearance";
/** An HTML-free format shared by both review clients. */
export type RichInline =
  | { readonly kind: "text" | "strong" | "emphasis" | "code" | "math"; readonly text: string }
  | { readonly kind: "image"; readonly text: string; readonly mediaId: string };
export type RichBlock = {
  readonly kind: "paragraph" | "heading" | "quote" | "bullet" | "number" | "math";
  readonly content: readonly RichInline[];
  readonly number?: number;
};

const inlinePattern =
  /!\[([^\]\n]{0,200})\]\(media:([a-zA-Z0-9_-]{1,160})\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\$([^$\n]+)\$|\\\(([^\n]*?)\\\)/g;

export function parseRichInline(text: string): readonly RichInline[] {
  const result: RichInline[] = [];
  let offset = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const index = match.index;
    if (index > offset) result.push({ kind: "text", text: text.slice(offset, index) });
    if (match[2]) result.push({ kind: "image", text: match[1] ?? "", mediaId: match[2] });
    else {
      const kind = match[3] ? "strong" : match[4] ? "emphasis" : match[5] ? "code" : "math";
      result.push({ kind, text: match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7] ?? "" });
    }
    offset = index + match[0].length;
  }
  if (offset < text.length) result.push({ kind: "text", text: text.slice(offset) });
  return result;
}

export function parseRichContent(text: string): readonly RichBlock[] {
  const blocks: RichBlock[] = [];
  let offset = 0;
  for (const match of text.matchAll(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g)) {
    const before = text.slice(offset, match.index).replace(/\n$/, "");
    if (before) blocks.push(...parseTextBlocks(before));
    blocks.push({
      kind: "math",
      content: [{ kind: "math", text: (match[1] ?? match[2] ?? "").trim() }],
    });
    offset = match.index + match[0].length;
    if (text[offset] === "\n") offset += 1;
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

const mathSymbols: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  sigma: "σ",
  phi: "φ",
  omega: "ω",
  Delta: "Δ",
  Sigma: "Σ",
  Omega: "Ω",
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
  leq: "≤",
  geq: "≥",
  neq: "≠",
  approx: "≈",
  infty: "∞",
  sum: "∑",
  int: "∫",
  partial: "∂",
  to: "→",
};
const superscript: Readonly<Record<string, string>> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
};
const subscript: Readonly<Record<string, string>> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
};
function script(value: string, table: Readonly<Record<string, string>>, prefix: string): string {
  const characters = value.match(/[0-9ni()+=-]/g) ?? [];
  return characters.length === value.length && characters.every((character) => table[character])
    ? characters.map((character) => table[character]).join("")
    : `${prefix}{${value}}`;
}
/** Common math notation, with unsupported TeX preserved as readable source. */
export function formatCardMath(source: string): string {
  return source
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\\([a-zA-Z]+)/g, (original: string, name: string) => mathSymbols[name] ?? original)
    .replace(
      /\^(?:\{([^{}]+)\}|([a-zA-Z0-9+-]))/g,
      (_match: string, group: string | undefined, single: string | undefined) =>
        script(group ?? single ?? "", superscript, "^"),
    )
    .replace(
      /_(?:\{([^{}]+)\}|([a-zA-Z0-9+-]))/g,
      (_match: string, group: string | undefined, single: string | undefined) =>
        script(group ?? single ?? "", subscript, "_"),
    );
}

export type RichInsertion = "bold" | "italic" | "code" | "bullet" | "number" | "math" | "image";
export function richInsertion(value: string, kind: RichInsertion): string {
  const snippets: Readonly<Record<RichInsertion, string>> = {
    bold: "**bold text**",
    italic: "*italic text*",
    code: "`code`",
    bullet: "\n- List item",
    number: "\n1. List item",
    math: "$E = mc^2$",
    image: "![Description](media:ATTACHMENT_ID)",
  };
  return value + (value && !value.endsWith("\n") ? " " : "") + snippets[kind];
}
