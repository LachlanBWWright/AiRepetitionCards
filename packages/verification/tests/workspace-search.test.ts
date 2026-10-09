import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { createAreaId, createAssessmentId } from "@recall/domain";
import {
  searchWorkspace,
  type KnowledgeNotebook,
  type WorkspaceSearchKind,
} from "@recall/application";
import { areaId, searchFixture, uuid } from "./fixtures/search-workspace";

const kinds: readonly WorkspaceSearchKind[] = [
  "area",
  "card",
  "objective",
  "concept",
  "material",
  "passage",
  "claim",
  "conversation",
  "suggestion",
];
void test("indexes every result kind and preserves precise navigation targets", () => {
  const { workspace, notebook } = searchFixture();
  const results = searchWorkspace(workspace, [{ notebook, namespace: "local:user" }], "channel");
  assert.deepEqual([...new Set(results.map((item) => item.kind))].sort(), [...kinds].sort());
  assert.equal(new Set(results.map((item) => item.id)).size, results.length);
  assert.ok(results.every((item) => item.areaId === areaId && item.areaTitle === "Channel area"));
  assert.deepEqual(results.find((item) => item.kind === "claim")?.target, {
    kind: "claim",
    claimId: uuid(7),
    materialId: uuid(4),
    sectionId: uuid(5),
    namespace: "local:user",
  });
  assert.deepEqual(results.find((item) => item.kind === "passage")?.target, {
    kind: "passage",
    materialId: uuid(4),
    sectionId: uuid(5),
    namespace: "local:user",
  });
  assert.deepEqual(results.find((item) => item.kind === "suggestion")?.target, {
    kind: "suggestion",
    proposalId: uuid(9),
    conceptId: notebook.concepts[0]?.id,
    namespace: "local:user",
  });
});
void test("search covers tags, objectives, answers, source quotations and tutor feedback", () => {
  const { workspace, notebook } = searchFixture();
  const notebooks = [{ notebook, namespace: "local" }];
  for (const [query, kind] of [
    ["golang", "area"],
    ["goroutines", "card"],
    ["prerequisite", "objective"],
    ["source quote", "claim"],
    ["learner answer", "conversation"],
    ["misconception", "conversation"],
    ["rationale", "suggestion"],
  ] as const) {
    assert.ok(
      searchWorkspace(workspace, notebooks, query).some((item) => item.kind === kind),
      query,
    );
  }
});
void test("accepted and discarded suggestions are absent; tutor evidence alone becomes conversations", () => {
  const { workspace, notebook } = searchFixture();
  const proposal = notebook.proposals[0];
  assert.ok(proposal);
  for (const status of ["accepted", "discarded"] as const) {
    assert.deepEqual(
      searchWorkspace(
        workspace,
        [{ namespace: "local", notebook: { ...notebook, proposals: [{ ...proposal, status }] } }],
        "channel",
        { kinds: ["suggestion"] },
      ),
      [],
    );
  }
  assert.equal(
    searchWorkspace(
      workspace,
      [{ notebook: { ...notebook, evidence: [] }, namespace: "local" }],
      "channel",
      { kinds: ["conversation"] },
    ).length,
    0,
  );
});
void test("duplicate namespace documents index once while distinct account namespaces remain distinct", () => {
  const { workspace, notebook } = searchFixture();
  const entries = [
    { notebook, namespace: "account:a" },
    { notebook, namespace: "account:a" },
    { notebook, namespace: "account:b" },
  ];
  const results = searchWorkspace(workspace, entries, "channel", { kinds: ["concept"] });
  assert.equal(results.length, 2);
  assert.equal(new Set(results.map((item) => item.id)).size, 2);
  assert.deepEqual(
    results.map((item) => (item.target.kind === "concept" ? item.target.namespace : "")).sort(),
    ["account:a", "account:b"],
  );
  // Search indexes only notebooks supplied by the owner-scoped adapter.
  assert.equal(
    searchWorkspace(workspace, entries.slice(0, 1), "channel", { kinds: ["concept"] }).length,
    1,
  );
});
void test("notebooks belonging to absent areas and retained deleted content are not indexed", () => {
  const { workspace, notebook } = searchFixture();
  const area = workspace.areas[0];
  assert.ok(area);
  assert.deepEqual(
    searchWorkspace(
      { ...workspace, areas: [], retainedReviewAreas: [area], deletedAreas: [{ areaId }] },
      [{ notebook, namespace: "local" }],
      "channel",
    ),
    [],
  );
  assert.deepEqual(
    searchWorkspace(
      workspace,
      [{ notebook: { ...notebook, areaId: createAreaId(uuid(100)) }, namespace: "local" }],
      "channel",
      { kinds: ["concept"] },
    ),
    [],
  );
});
void test("kind filters accept combinations and an empty filter returns no results", () => {
  const { workspace, notebook } = searchFixture();
  const entries = [{ notebook, namespace: "local" }];
  for (const kind of kinds)
    assert.ok(
      searchWorkspace(workspace, entries, "channel", { kinds: [kind] }).every(
        (item) => item.kind === kind,
      ),
    );
  assert.deepEqual(searchWorkspace(workspace, entries, "channel", { kinds: [] }), []);
  assert.deepEqual(
    new Set(
      searchWorkspace(workspace, entries, "channel", { kinds: ["card", "concept"] }).map(
        (item) => item.kind,
      ),
    ),
    new Set(["card", "concept"]),
  );
});
void test("queries use all terms across title and body, fold Unicode/whitespace and ignore repeated terms", () => {
  const { workspace, notebook } = searchFixture();
  const entries = [{ notebook, namespace: "local" }];
  assert.deepEqual(searchWorkspace(workspace, entries, " \t\n\u2003"), []);
  assert.deepEqual(searchWorkspace(workspace, entries, "channel absent"), []);
  assert.ok(
    searchWorkspace(workspace, entries, "question answer", { kinds: ["card"] }).length === 1,
  );
  assert.deepEqual(
    searchWorkspace(workspace, entries, "ＣＨＡＮＮＥＬ\t answer"),
    searchWorkspace(workspace, entries, "channel answer"),
  );
  assert.deepEqual(
    searchWorkspace(workspace, entries, "channel channel")
      .map((item) => item.id)
      .sort(),
    searchWorkspace(workspace, entries, "channel")
      .map((item) => item.id)
      .sort(),
  );
});
void test("ranking prefers exact title then phrase title then body match and has stable ties", () => {
  const { workspace } = searchFixture();
  const area = workspace.areas[0];
  const card = area?.cards[0];
  assert.ok(area && card);
  const cards = [
    { ...card, id: createAssessmentId(uuid(20)), front: "Other subject", back: "channel" },
    { ...card, id: createAssessmentId(uuid(22)), front: "channel details" },
    { ...card, id: createAssessmentId(uuid(21)), front: "channel" },
  ];
  const updated = { ...workspace, areas: [{ ...area, cards }] };
  const results = searchWorkspace(updated, [], "channel", { kinds: ["card"] });
  assert.deepEqual(
    results.map((item) => item.title),
    ["channel", "channel details", "Other subject"],
  );
  assert.deepEqual(
    results,
    searchWorkspace(
      { ...updated, areas: [{ ...area, cards: [...cards].reverse() }] },
      [],
      "channel",
      { kinds: ["card"] },
    ),
  );
});
void test("snippets center body matches, collapse whitespace, and mark truncation without modifying content", () => {
  const { workspace } = searchFixture();
  const area = workspace.areas[0],
    card = area?.cards[0];
  assert.ok(area && card);
  const back = `${"prefix ".repeat(50)}needle\n\tanswer${" suffix".repeat(50)}`;
  const updated = { ...workspace, areas: [{ ...area, cards: [{ ...card, back }] }] };
  const snippet = searchWorkspace(updated, [], "needle", { kinds: ["card"] })[0]?.snippet;
  assert.ok(snippet);
  assert.ok(snippet.includes("needle answer"));
  assert.ok(snippet.startsWith("…") && snippet.endsWith("…"));
  assert.ok(snippet.length <= 212);
  assert.equal(updated.areas[0]?.cards[0]?.back, back);
});
void test("result limits clamp safely, empty libraries return nothing and search is immutable", () => {
  const { workspace } = searchFixture();
  const area = workspace.areas[0],
    card = area?.cards[0];
  assert.ok(area && card);
  const cards = Array.from({ length: 220 }, (_, i) =>
    Object.freeze({ ...card, id: createAssessmentId(uuid(100 + i)) }),
  );
  const updated = Object.freeze({
    ...workspace,
    areas: Object.freeze([Object.freeze({ ...area, cards: Object.freeze(cards) })]),
  });
  const before = JSON.stringify(updated);
  for (const [limit, count] of [
    [0, 1],
    [-1, 1],
    [2.9, 2],
    [NaN, 50],
    [Infinity, 50],
    [1000, 200],
  ] as const)
    assert.equal(searchWorkspace(updated, [], "channel", { kinds: ["card"], limit }).length, count);
  assert.equal(JSON.stringify(updated), before);
  assert.deepEqual(searchWorkspace({ ...workspace, areas: [] }, [], "channel"), []);
});
void test("property: whitespace variants preserve results and limits are result prefixes", () => {
  const { workspace, notebook } = searchFixture();
  const entries = [{ notebook, namespace: "local" }];
  fc.assert(
    fc.property(
      fc.constantFrom(" ", "\t", "\n", "\u2003"),
      fc.integer({ min: 1, max: 20 }),
      (space, limit) => {
        const full = searchWorkspace(workspace, entries, "channel answer");
        assert.deepEqual(
          searchWorkspace(workspace, entries, `${space}channel${space}answer${space}`, { limit }),
          full.slice(0, limit),
        );
      },
    ),
    { seed: 420, numRuns: 60 },
  );
});

void test("snippets include Unicode matches after compatibility characters expand during normalization", () => {
  const { workspace } = searchFixture();
  const area = workspace.areas[0],
    card = area?.cards[0];
  assert.ok(area && card);
  const back = `${"ﬃ".repeat(160)} needle ${"tail ".repeat(100)}`;
  const results = searchWorkspace(
    { ...workspace, areas: [{ ...area, cards: [{ ...card, back }] }] },
    [],
    "needle",
  );
  assert.equal(results.length, 1);
  assert.ok(results[0]?.snippet.includes("needle"));
});

void test("cloze text and selected or skipped source claims remain discoverable", () => {
  const { workspace, notebook } = searchFixture();
  const area = workspace.areas[0],
    card = area?.cards[0],
    plan = notebook.coveragePlans?.[0],
    claim = plan?.claims[0];
  assert.ok(area && card && plan && claim);
  const updated = {
    ...workspace,
    areas: [
      {
        ...area,
        cards: [
          {
            ...card,
            cloze: { text: "{{c1::synchronization}} coordinates goroutines", deletionIndex: 1 },
          },
        ],
      },
    ],
  };
  assert.equal(searchWorkspace(updated, [], "synchronization", { kinds: ["card"] }).length, 1);
  for (const decision of ["pending", "selected", "skipped"] as const) {
    const document: KnowledgeNotebook = {
      ...notebook,
      coveragePlans: [{ ...plan, claims: [{ ...claim, decision }] }],
    };
    assert.equal(
      searchWorkspace(updated, [{ notebook: document, namespace: "local" }], "channel", {
        kinds: ["claim"],
      }).length,
      1,
    );
  }
});
