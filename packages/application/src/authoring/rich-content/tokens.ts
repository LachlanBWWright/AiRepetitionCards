export function escapedAt(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashes++;
  return slashes % 2 === 1;
}
export function closingToken(text: string, token: string, start: number): number {
  let cursor = text.indexOf(token, start);
  while (cursor >= 0 && escapedAt(text, cursor))
    cursor = text.indexOf(token, cursor + token.length);
  return cursor;
}
export function codeSpan(text: string, start: number) {
  if (text[start] !== "`" || escapedAt(text, start)) return null;
  let count = 1;
  while (text[start + count] === "`") count++;
  const marker = "`".repeat(count);
  const end = closingToken(text, marker, start + count);
  if (end < 0) return null;
  return { text: text.slice(start + count, end), end: end + count };
}
