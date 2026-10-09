import type { ClozeContent, KnowledgeArea, Workspace } from "@recall/domain";

/** Inputs are validated card/proposal content; matches are advisory, never a mutation. */
export type CardDuplicateContent = {
  readonly front: string;
  readonly back: string;
  readonly cloze?: ClozeContent;
};
export type CardDuplicateCandidate = CardDuplicateContent & {
  readonly id: string;
  readonly areaId?: string;
  readonly areaTitle?: string;
};
export type CardDuplicateKind = "exact" | "similar" | "conflicting";
export type CardDuplicateMatch = {
  readonly candidate: CardDuplicateCandidate;
  readonly kind: CardDuplicateKind;
  readonly score: number;
  readonly reason: string;
};
export type CardDuplicatePair = {
  readonly left: CardDuplicateCandidate;
  readonly right: CardDuplicateCandidate;
  readonly kind: CardDuplicateKind;
  readonly score: number;
  readonly reason: string;
};
export type CardDuplicateOptions = {
  readonly excludeCardId?: string;
  readonly limit?: number;
};

const filler = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "what",
  "which",
  "how",
  "does",
  "do",
  "describe",
  "explain",
  "define",
]);

function normalized(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.,?:;"'`(){}\[\]]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): ReadonlySet<string> {
  return new Set(
    (text.slice(0, 20_000).match(/[\p{L}\p{N}_]+|[+*=<>!#/-]+/gu) ?? [])
      .filter((token) => !filler.has(token))
      .slice(0, 512),
  );
}

type Prepared = {
  readonly front: string;
  readonly back: string;
  readonly frontTokens: ReadonlySet<string>;
  readonly backTokens: ReadonlySet<string>;
};

function prepare(content: CardDuplicateContent): Prepared {
  let front = content.front;
  let back = content.back;
  // Compare the actual retrieval target, not the full cloze sentence or its numeric index.
  const text = content.cloze?.text ?? content.front;
  const deletions = [...text.matchAll(/\{\{c([1-9]|1[0-9]|20)::([^{}]+?)\}\}/g)];
  const indices = new Set(deletions.map((match) => Number(match[1])));
  const selected =
    content.cloze?.deletionIndex ?? (indices.size === 1 ? [...indices][0] : undefined);
  if (selected !== undefined && indices.has(selected)) {
    const answers: string[] = [];
    front = text.replace(
      /\{\{c([1-9]|1[0-9]|20)::([^{}]+?)\}\}/g,
      (_whole: string, index: string, contents: string) => {
        const answer = contents.split("::")[0] ?? "";
        if (Number(index) !== selected) return answer;
        answers.push(answer);
        return " [recall gap] ";
      },
    );
    back = answers.join(" | ");
  }
  const question = normalized(front);
  const answer = normalized(back);
  return {
    front: question,
    back: answer,
    frontTokens: tokens(question),
    backTokens: tokens(answer),
  };
}

function prepareTargets(content: CardDuplicateContent): readonly Prepared[] {
  if (content.cloze) return [prepare(content)];
  const indices = [
    ...new Set(
      [...content.front.matchAll(/\{\{c([1-9]|1[0-9]|20)::([^{}]+?)\}\}/g)].map((match) =>
        Number(match[1]),
      ),
    ),
  ];
  return indices.length > 1
    ? indices.map((deletionIndex) =>
        prepare({
          ...content,
          cloze: { text: content.front, deletionIndex },
        }),
      )
    : [prepare(content)];
}

function similarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

function criticalTokens(values: ReadonlySet<string>): string {
  return [...values]
    .filter(
      (token) =>
        /\p{N}|^[+*=<>!#/-]+$/u.test(token) ||
        ["not", "never", "without", "except", "no", "cannot", "true", "false"].includes(token),
    )
    .sort()
    .join("|");
}

type Comparison = Omit<CardDuplicateMatch, "candidate">;
function compare(left: Prepared, right: Prepared): Comparison | undefined {
  if (!left.front || !right.front || !left.back || !right.back) return undefined;
  if (left.front === right.front) {
    if (left.back === right.back)
      return {
        kind: "exact",
        score: 1,
        reason: "The question and answer match an existing card.",
      };
    return {
      kind: "conflicting",
      score: 1,
      reason:
        "The question matches, but the answer differs. Check both answers before replacing a card.",
    };
  }
  // Short or generic prompts lack enough context for a reliable wording match.
  if (
    left.front.length > 20_000 ||
    right.front.length > 20_000 ||
    left.back.length > 20_000 ||
    right.back.length > 20_000
  )
    return undefined;
  if (left.frontTokens.size < 4 || right.frontTokens.size < 4) return undefined;
  if (
    criticalTokens(left.frontTokens) !== criticalTokens(right.frontTokens) ||
    criticalTokens(left.backTokens) !== criticalTokens(right.backTokens)
  )
    return undefined;
  const questionSimilarity = similarity(left.frontTokens, right.frontTokens);
  if (questionSimilarity < 0.8) return undefined;
  const answerSimilarity =
    left.back === right.back ? 1 : similarity(left.backTokens, right.backTokens);
  if (answerSimilarity < 0.7) return undefined;
  return {
    kind: "similar",
    score: Number((questionSimilarity * 0.7 + answerSimilarity * 0.3).toFixed(3)),
    reason:
      "The question and answer use very similar wording. Check whether they test the same fact.",
  };
}

function resultLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(1, Math.min(200, Math.floor(value)))
    : fallback;
}

/** Searches all supplied cards, returning the strongest matches with stable tie ordering. */
export function findCardDuplicates(
  draft: CardDuplicateContent,
  candidates: readonly CardDuplicateCandidate[],
  options: CardDuplicateOptions = {},
): readonly CardDuplicateMatch[] {
  const targets = prepareTargets(draft);
  const matches = new Map<string, CardDuplicateMatch>();
  for (const candidate of candidates) {
    if (candidate.id === options.excludeCardId) continue;
    for (const candidateTarget of prepareTargets(candidate)) {
      for (const target of targets) {
        const comparison = compare(target, candidateTarget);
        const previous = matches.get(candidate.id);
        if (
          comparison &&
          (!previous ||
            comparison.score > previous.score ||
            (comparison.score === previous.score && comparison.kind === "exact"))
        ) {
          matches.set(candidate.id, { candidate, ...comparison });
        }
      }
    }
  }
  return [...matches.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.candidate.id < right.candidate.id
          ? -1
          : left.candidate.id > right.candidate.id
            ? 1
            : 0),
    )
    .slice(0, resultLimit(options.limit, 5));
}

export function workspaceDuplicateCandidates(
  workspace: Workspace,
): readonly CardDuplicateCandidate[] {
  return workspace.areas.flatMap((area) =>
    area.cards.map((card) => ({
      id: card.id,
      areaId: area.id,
      areaTitle: area.title,
      front: card.front,
      back: card.back,
      ...(card.cloze ? { cloze: card.cloze } : {}),
    })),
  );
}

/** Knowledge-area cloze notes may represent several retrieval targets under one card ID. */
export function knowledgeAreaDuplicateCandidates(
  area: KnowledgeArea,
): readonly CardDuplicateCandidate[] {
  return area.cards.flatMap((card): readonly CardDuplicateCandidate[] => {
    const identity = { id: card.id, areaId: area.id, areaTitle: area.title };
    if (card.kind === "basic") return [{ ...identity, front: card.front, back: card.back }];
    const indices =
      card.deletionIndex === undefined
        ? [
            ...new Set(
              [...card.text.matchAll(/\{\{c([1-9]|1[0-9]|20)::([^{}]+?)\}\}/g)].map((match) =>
                Number(match[1]),
              ),
            ),
          ].sort((left, right) => left - right)
        : [card.deletionIndex];
    return indices.map((deletionIndex) => ({
      ...identity,
      front: card.text,
      back: card.text,
      cloze: { text: card.text, deletionIndex },
    }));
  });
}

/** Reusable for pending AI proposals; identifiers must be stable within their batch. */
export function proposalDuplicateCandidates(
  proposals: readonly { readonly id: string; readonly proposal: CardDuplicateContent }[],
): readonly CardDuplicateCandidate[] {
  return proposals.map(({ id, proposal }) => ({ id, ...proposal }));
}

/** Library audit uses an inverted question-token index instead of comparing every card pair.
 * Work and output are bounded; the audit is a shortlist, not proof that a library has no duplicates. */
export function findDuplicateCardPairs(
  candidates: readonly CardDuplicateCandidate[],
  options: { readonly limit?: number; readonly maxComparisons?: number } = {},
): readonly CardDuplicatePair[] {
  const limit = resultLimit(options.limit, 100);
  const maxComparisons =
    options.maxComparisons !== undefined && Number.isFinite(options.maxComparisons)
      ? Math.max(1, Math.min(1_000_000, Math.floor(options.maxComparisons)))
      : 250_000;
  const index = new Map<string, number[]>();
  // One logical card may supply several cloze retrieval targets under its canonical ID.
  const identities = new Map<
    string,
    { readonly card: CardDuplicateCandidate; readonly targets: readonly Prepared[] }
  >();
  for (const card of candidates) {
    const previous = identities.get(card.id);
    const targets = new Map(
      [...(previous?.targets ?? []), ...prepareTargets(card)].map((target) => [
        JSON.stringify([target.front, target.back]),
        target,
      ]),
    );
    identities.set(card.id, { card: previous?.card ?? card, targets: [...targets.values()] });
  }
  const cards = [...identities.values()];
  const matches: CardDuplicatePair[] = [];
  let comparisons = 0;
  for (const [position, current] of cards.entries()) {
    const keys = [
      ...new Set(
        current.targets.flatMap((target) => [
          `question:${target.front}`,
          ...[...target.frontTokens].map((token) => `token:${token}`),
        ]),
      ),
    ];
    const neighbors = new Set<number>();
    for (const key of keys) for (const neighbor of index.get(key) ?? []) neighbors.add(neighbor);
    for (const neighbor of neighbors) {
      const earlier = cards[neighbor];
      if (!earlier) continue;
      let strongest: Comparison | undefined;
      for (const left of earlier.targets) {
        for (const right of current.targets) {
          comparisons += 1;
          if (comparisons > maxComparisons) return matches.slice(0, limit);
          const comparison = compare(left, right);
          if (
            comparison &&
            (!strongest ||
              comparison.score > strongest.score ||
              (comparison.score === strongest.score && comparison.kind === "exact"))
          )
            strongest = comparison;
        }
      }
      if (strongest) matches.push({ left: earlier.card, right: current.card, ...strongest });
      if (matches.length >= limit) return matches;
    }
    for (const key of keys) {
      const entries = index.get(key) ?? [];
      entries.push(position);
      index.set(key, entries);
    }
  }
  return matches;
}
