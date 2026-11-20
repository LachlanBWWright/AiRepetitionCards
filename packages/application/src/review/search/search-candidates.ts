import type { StudyQuery } from "./query-parser";

/** Posting lists use sorted row offsets, avoiding duplicated card objects and identifiers. */
export type SearchPostings = ReadonlyMap<string, readonly number[]>;
export function textGrams(text: string): ReadonlySet<string> {
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= text.length; i += 1) grams.add(text.slice(i, i + 3));
  return grams;
}
export function createTextPostings(texts: readonly string[]): SearchPostings {
  const postings = new Map<string, number[]>();
  for (const [row, text] of texts.entries())
    for (const gram of textGrams(text)) {
      const rows = postings.get(gram);
      if (rows) rows.push(row);
      else postings.set(gram, [row]);
    }
  return postings;
}
function intersect(left: readonly number[], right: readonly number[]): readonly number[] {
  const result: number[] = [];
  let a = 0;
  let b = 0;
  while (a < left.length && b < right.length) {
    const x = left[a];
    const y = right[b];
    if (x === undefined || y === undefined) break;
    if (x === y) {
      result.push(x);
      a += 1;
      b += 1;
    } else if (x < y) a += 1;
    else b += 1;
  }
  return result;
}
/** Undefined means scan all rows. Candidates are a superset; the query still verifies matches. */
export function searchCandidateRows(
  query: StudyQuery,
  postings: SearchPostings,
): readonly number[] | undefined {
  if (query.kind === "not") return undefined;
  if (query.kind === "term") {
    if (query.value.includes(":")) return undefined;
    const grams = [...textGrams(query.value.replace(/"/g, "").normalize("NFKC").toLowerCase())];
    const lists = grams.map((gram) => postings.get(gram) ?? []).sort((a, b) => a.length - b.length);
    return lists.reduce<readonly number[] | undefined>(
      (rows, list) => (rows === undefined ? list : intersect(rows, list)),
      undefined,
    );
  }
  const left = searchCandidateRows(query.left, postings);
  const right = searchCandidateRows(query.right, postings);
  if (query.kind === "and") {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return intersect(left, right);
  }
  if (left === undefined || right === undefined) return undefined;
  return [...new Set([...left, ...right])].sort((a, b) => a - b);
}
