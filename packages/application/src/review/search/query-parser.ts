import { Either } from "effect";

export type StudySearchFailure = { readonly _tag: "StudySearchInvalid"; readonly message: string };
export type StudyQuery =
  | { readonly kind: "term"; readonly value: string }
  | { readonly kind: "not"; readonly child: StudyQuery }
  | { readonly kind: "and" | "or"; readonly left: StudyQuery; readonly right: StudyQuery };
const failure = (message: string): Either.Either<never, StudySearchFailure> =>
  Either.left({ _tag: "StudySearchInvalid", message });

function tokenize(query: string): Either.Either<readonly string[], StudySearchFailure> {
  const tokens: string[] = [];
  let word = "";
  let quoted = false;
  for (const character of query) {
    if (character === '"') {
      quoted = !quoted;
      word += character;
    } else if (!quoted && (character === "(" || character === ")" || /\s/.test(character))) {
      if (word) {
        tokens.push(word);
        word = "";
      }
      if (character === "(" || character === ")") tokens.push(character);
    } else word += character;
  }
  if (quoted) return failure("Close the quoted phrase.");
  if (word) tokens.push(word);
  return tokens.length > 100 ? failure("Use no more than 100 search terms.") : Either.right(tokens);
}

export function parseStudyQuery(input: unknown): Either.Either<StudyQuery, StudySearchFailure> {
  if (typeof input !== "string" || input.length > 500)
    return failure("Use a search of at most 500 characters.");
  const lexed = tokenize(input);
  if (Either.isLeft(lexed)) return Either.left(lexed.left);
  const tokens = lexed.right;
  let index = 0;
  function atom(depth: number): Either.Either<StudyQuery, StudySearchFailure> {
    if (depth > 8) return failure("Use at most eight nested groups.");
    const token = tokens[index++];
    if (!token || token === ")" || token === "OR" || token === "AND")
      return failure("Add a search term after the operator.");
    if (token === "-" || token === "NOT") {
      const child = atom(depth + 1);
      return Either.isLeft(child) ? child : Either.right({ kind: "not", child: child.right });
    }
    if (token === "(") {
      const group = expression(depth + 1);
      if (Either.isLeft(group)) return group;
      if (tokens[index++] !== ")") return failure("Close the search group with a parenthesis.");
      return group;
    }
    return token.startsWith("-")
      ? Either.right({ kind: "not", child: { kind: "term", value: token.slice(1) } })
      : Either.right({ kind: "term", value: token });
  }
  function conjunction(depth: number): Either.Either<StudyQuery, StudySearchFailure> {
    const initial = atom(depth);
    if (Either.isLeft(initial)) return initial;
    let left: StudyQuery = initial.right;
    while (index < tokens.length && tokens[index] !== ")" && tokens[index] !== "OR") {
      if (tokens[index] === "AND") index += 1;
      const right = atom(depth);
      if (Either.isLeft(right)) return right;
      left = { kind: "and", left, right: right.right };
    }
    return Either.right(left);
  }
  function expression(depth: number): Either.Either<StudyQuery, StudySearchFailure> {
    const initial = conjunction(depth);
    if (Either.isLeft(initial)) return initial;
    let left: StudyQuery = initial.right;
    while (tokens[index] === "OR") {
      index += 1;
      const right = conjunction(depth);
      if (Either.isLeft(right)) return right;
      left = { kind: "or", left, right: right.right };
    }
    return Either.right(left);
  }
  if (tokens.length === 0) return Either.right({ kind: "term", value: "" });
  const result = expression(0);
  return index < tokens.length ? failure("Unexpected parenthesis or operator.") : result;
}

export function queryTerms(query: StudyQuery): readonly string[] {
  if (query.kind === "term") return [query.value];
  if (query.kind === "not") return queryTerms(query.child);
  return [...queryTerms(query.left), ...queryTerms(query.right)];
}
export function matchesStudyQuery(query: StudyQuery, matches: (term: string) => boolean): boolean {
  if (query.kind === "term") return matches(query.value);
  if (query.kind === "not") return !matchesStudyQuery(query.child, matches);
  if (query.kind === "and")
    return matchesStudyQuery(query.left, matches) && matchesStudyQuery(query.right, matches);
  return matchesStudyQuery(query.left, matches) || matchesStudyQuery(query.right, matches);
}
