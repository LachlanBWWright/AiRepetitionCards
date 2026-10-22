type Section = { readonly field: string; readonly visible: boolean };

/** A bounded text template language. Field values are inserted once, never reinterpreted. */
export function renderNoteTemplate(
  template: string,
  fields: Readonly<Record<string, string>>,
  allowed: ReadonlySet<string>,
): string | undefined {
  const sections: Section[] = [];
  let output = "";
  let offset = 0;
  for (const match of template.matchAll(/\{\{([^{}]+)\}\}/g)) {
    if (template[match.index - 1] === "{" || template[match.index + match[0].length] === "}")
      return undefined;
    const literal = template.slice(offset, match.index);
    if (literal.includes("{{") || literal.includes("}}")) return undefined;
    if (sections.every((section) => section.visible)) output += literal;
    const token = (match[1] ?? "").trim();
    const marker = token.charAt(0);
    const name = ["#", "^", "/"].includes(marker) ? token.slice(1).trim() : token;
    if (!allowed.has(name)) return undefined;
    if (marker === "#" || marker === "^") {
      if (sections.length >= 20) return undefined;
      const populated = Boolean(fields[name]?.trim());
      sections.push({ field: name, visible: marker === "#" ? populated : !populated });
    } else if (marker === "/") {
      if (sections.pop()?.field !== name) return undefined;
    } else if (sections.every((section) => section.visible)) output += fields[name] ?? "";
    offset = match.index + match[0].length;
  }
  const tail = template.slice(offset);
  if (sections.length || tail.includes("{{") || tail.includes("}}")) return undefined;
  return (output + tail).trim();
}
