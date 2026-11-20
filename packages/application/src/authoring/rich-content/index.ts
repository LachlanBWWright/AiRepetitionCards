export * from "./selection";
export * from "./appearance";
export * from "./types";
export * from "./inline";
export * from "./blocks";
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
export * from "./equations";
