import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { createAssessmentId } from "@recall/domain";
import {
  findCardDuplicates,
  findDuplicateCardPairs,
  knowledgeAreaDuplicateCandidates,
  proposalDuplicateCandidates,
  workspaceDuplicateCandidates,
  type CardDuplicateCandidate,
  type CardDuplicateContent,
} from "@recall/application";
import { knowledgeArea, searchFixture, uuid } from "./fixtures/search-workspace";

const draft = {
  front: "Explain buffered channel communication safety",
  back: "Values queue until capacity fills",
};
const candidate = (id: string, content: CardDuplicateContent = draft): CardDuplicateCandidate => ({
  id,
  ...content,
});
void test("normalization recognizes compatibility Unicode, punctuation, casing and whitespace", () => {
  const original = { front: "Ｃａｆé: channels?", back: "A café." };
  const match = findCardDuplicates(original, [
    candidate("unicode", { front: "cafe\u0301 channels", back: "a cafe\u0301" }),
  ]);
  assert.equal(match[0]?.kind, "exact");
  assert.equal(match[0].score, 1);
  assert.equal(
    findCardDuplicates({ front: "   ", back: "answer" }, [
      candidate("empty", { front: "", back: "answer" }),
    ]).length,
    0,
  );
});
void test("same prompt and a different answer is a conflict even for short prompts", () => {
  assert.equal(
    findCardDuplicates({ front: "Capital?", back: "Paris" }, [
      candidate("other", { front: "Capital", back: "Rome" }),
    ])[0]?.kind,
    "conflicting",
  );
  for (const front of ["Define channel", "Explain a channel", "What is channel"]) {
    assert.deepEqual(
      findCardDuplicates({ front, back: "Communication" }, [
        candidate("generic", { front: "Describe channel", back: "Communication" }),
      ]),
      [],
    );
  }
});
void test("question and answer similarity thresholds include the boundary and reject below it", () => {
  const left = { front: "alpha beta gamma delta", back: "one two three four five six seven" };
  assert.equal(
    findCardDuplicates(left, [
      candidate("question-boundary", { ...left, front: "alpha beta gamma delta epsilon" }),
    ])[0]?.kind,
    "similar",
  );
  assert.deepEqual(
    findCardDuplicates(left, [
      candidate("question-below", { ...left, front: "alpha beta gamma delta epsilon zeta" }),
    ]),
    [],
  );
  assert.equal(
    findCardDuplicates(left, [
      candidate("answer-boundary", {
        front: "alpha beta gamma delta epsilon",
        back: "one two three four five six seven eight nine ten",
      }),
    ])[0]?.kind,
    "similar",
  );
  assert.deepEqual(
    findCardDuplicates(left, [
      candidate("answer-below", {
        front: "alpha beta gamma delta epsilon",
        back: "one two three four five six seven eight nine ten eleven",
      }),
    ]),
    [],
  );
});
void test("near matching preserves numbers, operators and negation in prompts and answers", () => {
  for (const [left, right] of [
    ["1", "2"],
    ["+", "-"],
    ["<=", ">="],
    ["not", "never"],
    ["true", "false"],
    ["without", "with"],
  ] as const) {
    assert.deepEqual(
      findCardDuplicates({ front: `${draft.front} ${left}`, back: draft.back }, [
        candidate("meaning", { front: `${draft.front} ${right} details`, back: draft.back }),
      ]),
      [],
    );
    assert.deepEqual(
      findCardDuplicates({ front: draft.front, back: `${draft.back} ${left}` }, [
        candidate("answer", { front: `${draft.front} details`, back: `${draft.back} ${right}` }),
      ]),
      [],
    );
  }
});
void test("long exact text is supported while approximate comparison is bounded", () => {
  const long = "channel ".repeat(3000);
  assert.equal(
    findCardDuplicates({ front: long, back: "Answer" }, [
      candidate("exact", { front: long, back: "Answer" }),
    ])[0]?.kind,
    "exact",
  );
  assert.deepEqual(
    findCardDuplicates({ front: long, back: "Answer" }, [
      candidate("near", { front: `${long}extra`, back: "Answer" }),
    ]),
    [],
  );
});
void test("cloze compares retrieval targets, ignores hints and index labels and preserves other answers", () => {
  const text = "{{c1::Paris::city}} is in {{c2::France}}.";
  const cloze = { front: text, back: text, cloze: { text, deletionIndex: 1 } };
  assert.equal(
    findCardDuplicates(cloze, [
      candidate("renumbered", { front: "{{c3::Paris}} is in France", back: "irrelevant" }),
    ])[0]?.kind,
    "exact",
  );
  assert.deepEqual(
    findCardDuplicates(cloze, [
      candidate("different-target", { front: text, back: text, cloze: { text, deletionIndex: 2 } }),
    ]),
    [],
  );
  assert.equal(
    findCardDuplicates({ front: text, back: text }, [candidate("first", cloze)])[0]?.kind,
    "exact",
  );
  assert.equal(
    findCardDuplicates({ front: "{{c1::Paris}} and {{c1::Lyon}}", back: "ignored" }, [
      candidate("multiple", { front: "{{c4::Paris}} and {{c4::Lyon}}", back: "ignored" }),
    ])[0]?.kind,
    "exact",
  );
  assert.deepEqual(
    findCardDuplicates({ front: text, back: "answer", cloze: { text, deletionIndex: 20 } }, [
      candidate("first", cloze),
    ]),
    [],
  );
});
void test("canonical IDs deduplicate targets, exclusion removes all aliases, exact outranks conflict", () => {
  const matches = findCardDuplicates(draft, [
    candidate("same", { ...draft, back: "Different" }),
    candidate("same"),
    candidate("b"),
    candidate("a"),
  ]);
  assert.deepEqual(
    matches.map((match) => match.candidate.id),
    ["a", "b", "same"],
  );
  assert.equal(matches.find((match) => match.candidate.id === "same")?.kind, "exact");
  assert.deepEqual(
    findCardDuplicates(draft, [candidate("same"), candidate("same")], { excludeCardId: "same" }),
    [],
  );
});
void test("limits are finite bounded and deterministic and inputs remain untouched", () => {
  const candidates = Object.freeze(
    Array.from({ length: 220 }, (_, i) => Object.freeze(candidate(String(i).padStart(3, "0")))),
  );
  const before = JSON.stringify(candidates);
  for (const [limit, count] of [
    [0, 1],
    [-5, 1],
    [2.8, 2],
    [Infinity, 5],
    [NaN, 5],
    [1000, 200],
  ] as const) {
    assert.equal(findCardDuplicates(draft, candidates, { limit }).length, count);
  }
  assert.deepEqual(
    findCardDuplicates(draft, [...candidates].reverse()),
    findCardDuplicates(draft, candidates),
  );
  assert.equal(JSON.stringify(candidates), before);
});
void test("candidate adapters preserve identity, metadata and each distinct cloze target", () => {
  const area = knowledgeArea();
  const text = "{{c2::France}} and {{c1::Paris}} and {{c2::France}}";
  const clozeArea = {
    ...area,
    cards: [
      {
        kind: "cloze" as const,
        id: createAssessmentId(uuid(10)),
        text,
        tags: [],
        objectiveIds: [],
        origin: "authored" as const,
      },
    ],
  };
  const targets = knowledgeAreaDuplicateCandidates(clozeArea);
  assert.deepEqual(
    targets.map((item) => item.cloze?.deletionIndex),
    [1, 2],
  );
  assert.ok(targets.every((item) => item.id === uuid(10) && item.areaTitle === area.title));
  const clozeCard = clozeArea.cards[0];
  assert.ok(clozeCard);
  assert.equal(
    knowledgeAreaDuplicateCandidates({
      ...clozeArea,
      cards: [{ ...clozeCard, deletionIndex: 2 }],
    }).length,
    1,
  );
  assert.equal(workspaceDuplicateCandidates(searchFixture().workspace)[0]?.id, uuid(2));
  assert.deepEqual(proposalDuplicateCandidates([{ id: "pending", proposal: draft }]), [
    candidate("pending"),
  ]);
});
void test("audit skips self-identities, respects comparison and output bounds and is pure", () => {
  const candidates = [candidate("a"), candidate("a"), candidate("b"), candidate("c")];
  const before = structuredClone(candidates);
  const pairs = findDuplicateCardPairs(candidates, { limit: 1 });
  assert.equal(pairs.length, 1);
  const pair = pairs[0];
  assert.ok(pair);
  assert.notEqual(pair.left.id, pair.right.id);
  assert.equal(findDuplicateCardPairs(candidates, { maxComparisons: 1 }).length, 1);
  assert.deepEqual(findDuplicateCardPairs(candidates), findDuplicateCardPairs(candidates));
  assert.deepEqual(candidates, before);
});
void test("random candidate permutations preserve strongest-match ordering and self exclusion", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 1000 }), { maxLength: 40 }), (values) => {
      const candidates = values.map((value) => candidate(String(value)));
      const result = findCardDuplicates(draft, candidates, { limit: 200 });
      assert.deepEqual(
        result,
        findCardDuplicates(draft, [...candidates].reverse(), { limit: 200 }),
      );
      assert.ok(result.every((match) => match.kind === "exact" && match.score === 1));
      const excluded = candidates[0]?.id;
      assert.ok(
        findCardDuplicates(
          draft,
          candidates,
          excluded === undefined ? {} : { excludeCardId: excluded },
        ).every((match) => match.candidate.id !== excluded),
      );
    }),
    { seed: 419, numRuns: 80 },
  );
});

void test("audit expands batch cloze targets and reports one strongest canonical pair", () => {
  const text = "{{c1::Paris}} is in {{c2::France}}";
  const batch = candidate("batch", { front: text, back: text });
  const first = candidate("existing", {
    front: text,
    back: "unused",
    cloze: { text, deletionIndex: 1 },
  });
  const second = candidate("existing", {
    front: text,
    back: "unused",
    cloze: { text, deletionIndex: 2 },
  });
  const pairs = findDuplicateCardPairs([first, second, batch]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.kind, "exact");
  assert.deepEqual(new Set([pairs[0].left.id, pairs[0].right.id]), new Set(["batch", "existing"]));
  assert.equal(findDuplicateCardPairs([candidate("a"), candidate("a"), candidate("b")]).length, 1);
});
