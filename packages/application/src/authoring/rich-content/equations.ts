import { insertRichText, type RichSelection } from "./selection";

export const equationExamples = [
  { label: "Fraction", source: "\\frac{a}{b}" },
  { label: "Square root", source: "\\sqrt{x}" },
  { label: "Quadratic formula", source: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
  { label: "Matrix", source: "\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}" },
] as const;
export function equationSelection(value: string, selection: RichSelection) {
  const selected = value.slice(selection.start, selection.end);
  const display =
    (selected.startsWith("\\[") && selected.endsWith("\\]")) ||
    (selected.startsWith("$$") && selected.endsWith("$$"));
  const wrapped = display || (selected.startsWith("\\(") && selected.endsWith("\\)"));
  return {
    source: wrapped
      ? selected.slice(2, -2).trim()
      : selected.startsWith("$") && selected.endsWith("$")
        ? selected.slice(1, -1)
        : selected,
    display,
  };
}
export function insertEquation(
  value: string,
  selection: RichSelection,
  source: string,
  display: boolean,
) {
  const equation = display ? `\\[\n${source.trim()}\n\\]` : `\\(${source.trim()}\\)`;
  const before = display && selection.start > 0 && value[selection.start - 1] !== "\n" ? "\n" : "";
  const after =
    display && selection.end < value.length && value[selection.end] !== "\n" ? "\n" : "";
  return insertRichText(value, selection, before + equation + after);
}
