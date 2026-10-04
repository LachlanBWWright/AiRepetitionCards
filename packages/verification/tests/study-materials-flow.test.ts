import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createAreaId, createCardId, type KnowledgeArea } from "@recall/domain";
import type { TutorActionResponse } from "@recall/ai-core";
import { extractNativeStudyPaste } from "../../../apps/mobile/src/storage/native-study-material-extraction";
import {
  addNotebookMaterial,
  addMaterialCardProposals,
  beginNotebookSession,
  createStudyMaterialsTutor,
  deriveNotebookAssessments,
  removeNotebookMaterial,
  resolveNotebookProposal,
  seedKnowledgeNotebook,
  selectNextStudyMaterialSection,
  updateNotebookMaterial,
  type KnowledgeNotebook,
  type StudyMaterial,
} from "@recall/application";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: createAreaId(id(1)),
  title: "Go programming",
  description: null,
  language: "en",
  objectives: [],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [],
  tags: [],
  licence: null,
};
const material: StudyMaterial = {
  id: id(2),
  name: "Notes",
  format: "pdf",
  importedAt: 1000,
  sections: [
    {
      id: id(3),
      title: "Page 1",
      pageNumber: 1,
      text: "A goroutine runs concurrently.",
      selected: true,
    },
    {
      id: id(4),
      title: "Page 2",
      pageNumber: 2,
      text: "A channel carries values.",
      selected: true,
    },
  ],
  warnings: [],
};
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}
function fixture(maxRequests = 5): KnowledgeNotebook {
  return success(
    beginNotebookSession(
      success(addNotebookMaterial(success(seedKnowledgeNotebook(area, "Learn Go")), material)),
      {
        startedAt: 1000,
        maxQuestions: 10,
        maxRequests,
        maximumDurationMs: 60000,
      },
    ),
  );
}
function response(section = material.sections[0], proposalId = id(5)): TutorActionResponse {
  assert.ok(section);
  return {
    action: "study-card",
    sessionId: id(6),
    proposalId,
    providerResolutionRequired: false,
    result: {
      proposal: {
        front: `What does ${section.title} teach?`,
        back: section.text,
        objectiveId: null,
        rationale: "Source excerpt",
      },
      sourceReferences: [
        {
          materialId: material.id,
          sectionId: section.id,
          quote: section.text,
          pageNumber: section.pageNumber,
        },
      ],
      conceptSuggestions: [],
    },
  };
}

void test("a saved source card remains a proposal and balances the next batch across passages", async () => {
  const notebook = fixture();
  const before = JSON.stringify(notebook);
  const saved: KnowledgeNotebook[] = [];
  const tutor = createStudyMaterialsTutor({ request: () => Effect.succeed(response()) }, (next) =>
    Effect.sync(() => {
      saved.push(next);
    }),
  );
  const result = await Effect.runPromise(
    tutor.generate(
      notebook,
      { knowledgeArea: area, history: [] },
      {
        materialId: material.id,
        sectionId: id(3),
        conceptId: area.id,
        depth: "standard",
      },
      1001,
    ),
  );
  assert.equal(JSON.stringify(notebook), before);
  const reservation = saved[0];
  const proposal = result.notebook.proposals[0];
  assert.ok(reservation);
  assert.ok(proposal);
  assert.equal(reservation.session.requestsUsed, 1);
  assert.equal(reservation.proposals.length, 0);
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.providerResolutionRequired, false);
  assert.equal(result.notebook.evidence.length, 0);
  assert.equal(success(deriveNotebookAssessments(result.notebook))[0]?.status, "unassessed");
  assert.equal(selectNextStudyMaterialSection(result.notebook)?.section.id, id(4));
  const accepted = success(
    resolveNotebookProposal(result.notebook, {
      id: id(5),
      status: "accepted",
      cardId: createCardId(id(7)),
    }),
  );
  assert.equal(accepted.proposals[0]?.status, "accepted");
  assert.equal(success(deriveNotebookAssessments(accepted))[0]?.status, "unassessed");
});

void test("a provider cannot cite another selected passage that was not sent", async () => {
  const saved: KnowledgeNotebook[] = [];
  const tutor = createStudyMaterialsTutor(
    { request: () => Effect.succeed(response(material.sections[1])) },
    (next) =>
      Effect.sync(() => {
        saved.push(next);
      }),
  );
  const result = await Effect.runPromise(
    Effect.either(
      tutor.generate(
        fixture(),
        { knowledgeArea: area, history: [] },
        {
          materialId: material.id,
          sectionId: id(3),
          conceptId: area.id,
          depth: "standard",
        },
        1001,
      ),
    ),
  );
  assert.ok(Either.isLeft(result));
  assert.match(result.left.message, /outside the excerpt/);
  assert.equal(result.left.notebook?.session.requestsUsed, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.proposals.length, 0);
});

void test("request caps and failed persistence prevent provider calls", async () => {
  let calls = 0;
  const api = {
    request: () =>
      Effect.sync(() => {
        calls += 1;
        return response();
      }),
  };
  const notebook = fixture(1);
  const charged = { ...notebook, session: { ...notebook.session, requestsUsed: 1 } };
  const options = {
    materialId: material.id,
    sectionId: id(3),
    conceptId: area.id,
    depth: "standard",
  };
  const capped = await Effect.runPromise(
    Effect.either(
      createStudyMaterialsTutor(api, () => Effect.void).generate(
        charged,
        { knowledgeArea: area, history: [] },
        options,
        1001,
      ),
    ),
  );
  assert.ok(Either.isLeft(capped));
  const unsaved = await Effect.runPromise(
    Effect.either(
      createStudyMaterialsTutor(api, () => Effect.fail({ message: "Storage full" })).generate(
        notebook,
        { knowledgeArea: area, history: [] },
        options,
        1001,
      ),
    ),
  );
  assert.ok(Either.isLeft(unsaved));
  assert.equal(calls, 0);
});

void test("source references survive deselection, but invalid corrections and removal are rejected", () => {
  const notebook = fixture();
  const generated = response();
  assert.equal(generated.action, "study-card");
  const proposal = generated.result;
  const withCard = success(
    addMaterialCardProposals(notebook, {
      materialId: material.id,
      sectionId: id(3),
      proposals: [
        {
          id: id(5),
          conceptId: area.id,
          ...proposal,
          createdAt: 1001,
          providerResolutionRequired: false,
        },
      ],
    }),
  );
  const deselected = success(
    updateNotebookMaterial(withCard, {
      ...material,
      sections: material.sections.map((section) => ({ ...section, selected: false })),
    }),
  );
  assert.equal(selectNextStudyMaterialSection(deselected), null);
  const correction = Effect.runSync(
    Effect.either(
      updateNotebookMaterial(withCard, {
        ...material,
        sections: material.sections.map((section) => ({ ...section, text: "Altered" })),
      }),
    ),
  );
  assert.ok(Either.isLeft(correction));
  assert.ok(
    Either.isLeft(Effect.runSync(Effect.either(removeNotebookMaterial(withCard, material.id)))),
  );
});

void test("native import previews split long passages within the AI limit without damaging Unicode", () => {
  const original = `${"a".repeat(11999)}🧠${"b".repeat(13000)}`;
  const extracted = success(extractNativeStudyPaste(original));
  assert.ok(extracted.sections.length > 1);
  assert.ok(extracted.sections.every((section) => section.text.length <= 12000));
  assert.equal(extracted.sections.map((section) => section.text).join(""), original);
});
