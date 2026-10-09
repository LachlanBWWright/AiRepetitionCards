import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createAreaId, type KnowledgeArea } from "@recall/domain";
import {
  seedKnowledgeNotebook,
  addNotebookMaterial,
  addStudyCoveragePlan,
  updateStudyCoverageClaim,
  deriveStudyClaimCoverage,
  addNotebookProposal,
  resolveNotebookProposal,
  applyNotebookRefinement,
  updateNotebookMaterial,
  removeNotebookMaterial,
  type StudyCoveragePlan,
  type StudyMaterial,
} from "@recall/application";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: createAreaId(id(1)),
  title: "Study",
  description: null,
  language: "en",
  objectives: [],
  cards: [],
  tags: [],
  licence: null,
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
};
const material: StudyMaterial = {
  id: id(2),
  name: "Notes",
  format: "paste",
  importedAt: 1000,
  warnings: [],
  sections: [
    {
      id: id(3),
      title: "Concurrency",
      pageNumber: null,
      text: "A goroutine runs concurrently. Channels carry values.",
      selected: true,
    },
  ],
};
const reference = {
  materialId: id(2),
  sectionId: id(3),
  pageNumber: null,
  quote: "A goroutine runs concurrently.",
};
const plan: StudyCoveragePlan = {
  id: id(4),
  materialId: id(2),
  sectionId: id(3),
  createdAt: 1001,
  claims: [
    {
      id: id(5),
      title: "Concurrency",
      description: "Understand goroutines",
      priority: "high",
      decision: "pending",
      sourceReferences: [reference],
    },
  ],
};
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}
const fixture = () =>
  success(addNotebookMaterial(success(seedKnowledgeNotebook(area, "Learn concurrency")), material));
const planned = () => success(addStudyCoveragePlan(fixture(), plan));
const card = {
  front: "What executes concurrently?",
  back: "A goroutine.",
  objectiveId: null,
  rationale: "A source fact.",
};
function proposed() {
  return success(
    addNotebookProposal(
      planned(),
      {
        id: id(6),
        conceptId: area.id,
        evidenceIds: [],
        claimId: id(5),
        proposal: card,
        createdAt: 1002,
        sourceReferences: [reference],
        providerResolutionRequired: false,
      },
      [],
    ),
  );
}

void test("coverage rejects stale, foreign, wrong-page, and paraphrased citations", () => {
  const notebook = fixture();
  const before = JSON.stringify(notebook);
  for (const citation of [
    { ...reference, materialId: id(90) },
    { ...reference, sectionId: id(90) },
    { ...reference, pageNumber: 1 },
    { ...reference, quote: "Goroutines execute concurrently" },
    { ...reference, quote: "" },
  ]) {
    assert.ok(
      Either.isLeft(
        Effect.runSync(
          Effect.either(
            addStudyCoveragePlan(notebook, {
              ...plan,
              claims: [{ ...plan.claims[0], sourceReferences: [citation] }],
            }),
          ),
        ),
      ),
    );
  }
  assert.equal(JSON.stringify(notebook), before);
});

void test("coverage enforces globally unique plan and claim identities", () => {
  const notebook = planned();
  for (const invalid of [
    plan,
    { ...plan, id: id(7) },
    { ...plan, id: id(7), claims: [plan.claims[0], plan.claims[0]] },
  ])
    assert.ok(
      Either.isLeft(Effect.runSync(Effect.either(addStudyCoveragePlan(notebook, invalid)))),
    );
  assert.equal(notebook.coveragePlans?.length, 1);
});

void test("coverage edits require exact identities and remain immutable", () => {
  const notebook = planned();
  const before = JSON.stringify(notebook);
  const input = { planId: id(4), claimId: id(5), decision: "selected", priority: "low" };
  for (const invalid of [
    { ...input, planId: id(90) },
    { ...input, claimId: id(90) },
    { ...input, decision: "accepted" },
    { ...input, priority: "urgent" },
  ])
    assert.ok(
      Either.isLeft(Effect.runSync(Effect.either(updateStudyCoverageClaim(notebook, invalid)))),
    );
  const next = success(updateStudyCoverageClaim(notebook, input));
  assert.equal(next.coveragePlans?.[0]?.claims[0]?.priority, "low");
  assert.equal(JSON.stringify(notebook), before);
  assert.deepEqual(next.coveragePlans[0].claims[0].sourceReferences, [reference]);
});

void test("claim coverage reflects explicit selection, pending proposals, approval and skip decisions", () => {
  const notebook = proposed();
  assert.equal(success(deriveStudyClaimCoverage(notebook))[0]?.status, "pending");
  const selected = success(
    updateStudyCoverageClaim(notebook, {
      planId: id(4),
      claimId: id(5),
      decision: "selected",
      priority: "high",
    }),
  );
  assert.equal(success(deriveStudyClaimCoverage(selected))[0]?.status, "proposed");
  const accepted = success(
    resolveNotebookProposal(selected, { id: id(6), status: "accepted", cardId: id(8) }),
  );
  const coverage = success(deriveStudyClaimCoverage(accepted))[0];
  assert.equal(coverage?.status, "covered");
  assert.equal(coverage.approvedCards, 1);
  assert.equal(coverage.pendingCards, 0);
  const skipped = success(
    updateStudyCoverageClaim(accepted, {
      planId: id(4),
      claimId: id(5),
      decision: "skipped",
      priority: "low",
    }),
  );
  assert.equal(success(deriveStudyClaimCoverage(skipped))[0]?.status, "skipped");
  assert.equal(skipped.proposals[0]?.status, "accepted");
});

void test("discarded proposals leave selected claims uncovered", () => {
  const notebook = success(
    updateStudyCoverageClaim(proposed(), {
      planId: id(4),
      claimId: id(5),
      decision: "selected",
      priority: "medium",
    }),
  );
  const discarded = success(resolveNotebookProposal(notebook, { id: id(6), status: "discarded" }));
  assert.equal(success(deriveStudyClaimCoverage(discarded))[0]?.status, "uncovered");
});

void test("meaning-changing revisions and splits clear claim links while retaining source evidence", () => {
  const notebook = proposed();
  const baseline = { front: card.front, back: card.back, objectiveId: null };
  const revision = {
    ...card,
    front: "Which construct enables concurrency?",
    meaningChanged: true,
    sourceReferences: [reference],
  };
  const revised = success(
    applyNotebookRefinement(notebook, {
      proposalId: id(6),
      baseline,
      cards: [revision],
      newProposalIds: [],
    }),
  );
  assert.equal(revised.proposals[0]?.claimId, undefined);
  assert.deepEqual(revised.proposals[0]?.sourceReferences, [reference]);
  const unchanged = success(
    applyNotebookRefinement(notebook, {
      proposalId: id(6),
      baseline,
      cards: [{ ...revision, meaningChanged: false }],
      newProposalIds: [],
    }),
  );
  assert.equal(unchanged.proposals[0]?.claimId, id(5));
  const split = success(
    applyNotebookRefinement(notebook, {
      proposalId: id(6),
      baseline,
      cards: [revision, { ...revision, front: "What is concurrent execution?" }],
      newProposalIds: [id(10), id(11)],
    }),
  );
  for (const child of split.proposals.slice(1)) {
    assert.equal(child.claimId, undefined);
    assert.deepEqual(child.sourceReferences, [reference]);
  }
});

void test("coverage itself protects cited materials even before generating any card", () => {
  const notebook = planned();
  assert.ok(Either.isLeft(Effect.runSync(Effect.either(removeNotebookMaterial(notebook, id(2))))));
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(
          updateNotebookMaterial(notebook, {
            ...material,
            sections: [{ ...material.sections[0], text: "Changed source" }],
          }),
        ),
      ),
    ),
  );
  const deselected = success(
    updateNotebookMaterial(notebook, {
      ...material,
      sections: [{ ...material.sections[0], selected: false }],
    }),
  );
  assert.deepEqual(deselected.coveragePlans, notebook.coveragePlans);
});

void test("malformed material extraction cannot enter notebook storage", () => {
  const notebook = success(seedKnowledgeNotebook(area, "Study"));
  for (const invalid of [
    { ...material, sections: [] },
    { ...material, sections: [material.sections[0], material.sections[0]] },
    { ...material, sections: [{ ...material.sections[0], text: "" }] },
    { ...material, sections: [{ ...material.sections[0], text: "x".repeat(20001) }] },
    { ...material, sections: [{ ...material.sections[0], pageNumber: 0 }] },
    { ...material, importedAt: Infinity },
  ])
    assert.ok(Either.isLeft(Effect.runSync(Effect.either(addNotebookMaterial(notebook, invalid)))));
  assert.equal(notebook.materials?.length ?? 0, 0);
});
