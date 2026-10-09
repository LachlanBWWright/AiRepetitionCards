import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  createAreaId,
  createObjectiveId,
  type KnowledgeArea,
  type Workspace,
} from "@recall/domain";
import type { WorkspaceStore } from "../../local-store/src/index";
import {
  KnowledgeNotebookSchema,
  addMaterialCardProposals,
  addNotebookMaterial,
  appendNotebookAnswer,
  beginNotebookSession,
  deriveStudyMaterialCoverage,
  findCardDuplicates,
  loadWorkspace,
  persistTutorCardApproval,
  resolveNotebookProposal,
  searchWorkspace,
  seedKnowledgeNotebook,
  setNotebookQuestion,
  workspaceDuplicateCandidates,
  type KnowledgeNotebook,
  type StudyMaterial,
} from "@recall/application";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const areaId = createAreaId(id(10));
const objectiveId = createObjectiveId(id(11));
const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: areaId,
  title: "Go concurrency",
  description: null,
  language: "en",
  objectives: [
    { id: objectiveId, title: "Channels", description: "Channel ownership", prerequisiteIds: [] },
  ],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [],
  tags: [],
  licence: null,
};
const material: StudyMaterial = {
  id: id(12),
  name: "Concurrency notes",
  format: "pdf",
  importedAt: 1000,
  warnings: [],
  sections: [
    {
      id: id(13),
      title: "Channel ownership",
      pageNumber: 1,
      text: "The sender closes a channel after sending its final value.",
      selected: true,
    },
  ],
};
const proposal = {
  front: "Who closes a Go channel?",
  back: "The sender closes a channel after sending its final value.",
  objectiveId,
  rationale: "Recall ownership",
};
const batch = {
  materialId: material.id,
  sectionId: id(13),
  proposals: [
    {
      id: id(14),
      conceptId: objectiveId,
      proposal,
      createdAt: 1001,
      sourceReferences: [
        {
          materialId: material.id,
          sectionId: id(13),
          pageNumber: 1,
          quote: material.sections[0]?.text,
        },
      ],
    },
  ],
};
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
function notebook(): KnowledgeNotebook {
  return success(
    addMaterialCardProposals(
      success(
        addNotebookMaterial(
          success(seedKnowledgeNotebook(area, "Learn channel ownership")),
          material,
        ),
      ),
      batch,
    ),
  );
}
function workspace(): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    areas: [
      { id: areaId, title: area.title, color: "#123456", objectives: area.objectives, cards: [] },
    ],
  };
}
function disk() {
  let raw: string | null = null;
  let fail = false;
  const store: WorkspaceStore = {
    read: Effect.sync(() => raw),
    write: (next) =>
      Effect.suspend(() => {
        if (fail) return Effect.fail({ _tag: "LocalStoreFailure", operation: "write" } as const);
        raw = next;
        return Effect.void;
      }),
    clear: Effect.sync(() => {
      raw = null;
    }),
  };
  return {
    store,
    fail: () => {
      fail = true;
    },
  };
}

await test("material proposal discovery, durable approval and replay share a stable card identity", () => {
  const local = disk();
  const imported = notebook();
  const notebooks = [{ notebook: imported, namespace: "local" }];
  const passage = searchWorkspace(workspace(), notebooks, "sender closes", {
    kinds: ["passage"],
  })[0];
  assert.ok(passage);
  assert.deepEqual(passage.target, {
    kind: "passage",
    namespace: "local",
    materialId: material.id,
    sectionId: id(13),
  });
  assert.equal(
    searchWorkspace(workspace(), notebooks, "channel", { kinds: ["suggestion"] }).length,
    1,
  );
  const approval = { areaId, sessionId: id(15), proposalId: id(14), proposal };
  const approved = success(
    persistTutorCardApproval(local.store, workspace(), approval, new Date("2026-10-04T00:00:00Z")),
  );
  const loaded = success(loadWorkspace(local.store));
  assert.ok(loaded._tag === "Loaded");
  assert.equal(
    findCardDuplicates(proposal, workspaceDuplicateCandidates(loaded.workspace))[0]?.kind,
    "exact",
  );
  const retry = success(
    persistTutorCardApproval(
      local.store,
      loaded.workspace,
      approval,
      new Date("2026-10-05T00:00:00Z"),
    ),
  );
  assert.equal(retry.cardId, approved.cardId);
  assert.equal(retry.workspace.areas[0]?.cards.length, 1);
  assert.deepEqual(
    retry.workspace.areas[0].cards[0]?.schedule,
    approved.workspace.areas[0]?.cards[0]?.schedule,
  );
  const resolved = success(
    resolveNotebookProposal(imported, { id: id(14), status: "accepted", cardId: approved.cardId }),
  );
  const decoded = success(
    Schema.decodeUnknown(KnowledgeNotebookSchema)(JSON.parse(JSON.stringify(resolved)) as unknown),
  );
  assert.deepEqual(
    success(
      resolveNotebookProposal(decoded, { id: id(14), status: "accepted", cardId: approved.cardId }),
    ),
    decoded,
  );
  assert.equal(success(deriveStudyMaterialCoverage(decoded))[0]?.status, "approved");
  assert.equal(
    searchWorkspace(retry.workspace, [{ notebook: decoded, namespace: "local" }], "channel", {
      kinds: ["card"],
    }).length,
    1,
  );
});

await test("failed approval persistence retains the pending source proposal and original searchable library", () => {
  const local = disk();
  local.fail();
  const imported = notebook();
  const failed = Effect.runSync(
    Effect.either(
      persistTutorCardApproval(
        local.store,
        workspace(),
        { areaId, sessionId: id(15), proposalId: id(14), proposal },
        new Date("2026-10-04T00:00:00Z"),
      ),
    ),
  );
  assert.ok(Either.isLeft(failed));
  assert.equal(success(loadWorkspace(local.store))._tag, "Empty");
  assert.equal(imported.proposals[0]?.status, "pending");
  assert.equal(success(deriveStudyMaterialCoverage(imported))[0]?.status, "proposed");
  assert.equal(
    searchWorkspace(workspace(), [{ notebook: imported, namespace: "local" }], "channel", {
      kinds: ["card"],
    }).length,
    0,
  );
  assert.equal(
    searchWorkspace(workspace(), [{ notebook: imported, namespace: "local" }], "channel", {
      kinds: ["suggestion"],
    }).length,
    1,
  );
});

await test("saved tutor evidence is searchable with exact navigation targets, isolated namespaces and removed-area filtering", () => {
  const started = success(
    beginNotebookSession(notebook(), {
      startedAt: 1000,
      maxQuestions: 10,
      maxRequests: 20,
      maximumDurationMs: 60000,
    }),
  );
  const asked = success(
    setNotebookQuestion(started, {
      conceptId: objectiveId,
      now: 1001,
      question: {
        question: "Who closes the channel?",
        objectiveId,
        teachingIntent: "Recall ownership",
      },
    }),
  );
  const answered = success(
    appendNotebookAnswer(asked, {
      id: id(16),
      answer: "I thought the receiver closes the channel",
      learnerConfidence: "unsure",
      at: 1002,
      evaluation: {
        result: "incorrect",
        confidence: 0.95,
        feedback: "The sender closes the channel",
        misconception: "Receiver ownership",
        objectiveId,
        suggestedAction: "propose-card",
      },
    }),
  );
  const reloaded = success(
    Schema.decodeUnknown(KnowledgeNotebookSchema)(JSON.parse(JSON.stringify(answered)) as unknown),
  );
  const local = { notebook: reloaded, namespace: "local" };
  const other = { notebook: reloaded, namespace: "refinement" };
  const found = searchWorkspace(workspace(), [local, local, other], "receiver", {
    kinds: ["conversation"],
  });
  assert.equal(found.length, 2);
  assert.equal(new Set(found.map((result) => result.id)).size, 2);
  assert.deepEqual(
    found.find(
      (result) => result.target.kind === "conversation" && result.target.namespace === "local",
    )?.target,
    { kind: "conversation", namespace: "local", evidenceId: id(16), conceptId: objectiveId },
  );
  assert.equal(
    searchWorkspace({ ...workspace(), areas: [] }, [local, other], "receiver").length,
    0,
  );
  assert.equal(reloaded.evidence.length, 1);
});

await test("mixed source proposal batches reject forged quotes atomically before creating searchable suggestions", () => {
  const imported = success(
    addNotebookMaterial(success(seedKnowledgeNotebook(area, "Learn channels")), material),
  );
  const original = JSON.stringify(imported);
  const first = batch.proposals[0];
  assert.ok(first);
  const rejected = Effect.runSync(
    Effect.either(
      addMaterialCardProposals(imported, {
        ...batch,
        proposals: [
          first,
          {
            ...first,
            id: id(17),
            proposal: { ...proposal, front: "How does a receiver close a channel?" },
            sourceReferences: [
              {
                materialId: material.id,
                sectionId: id(13),
                pageNumber: 1,
                quote: "The receiver closes the channel",
              },
            ],
          },
        ],
      }),
    ),
  );
  assert.ok(Either.isLeft(rejected));
  assert.equal(JSON.stringify(imported), original);
  assert.equal(
    searchWorkspace(workspace(), [{ notebook: imported, namespace: "local" }], "channel", {
      kinds: ["suggestion"],
    }).length,
    0,
  );
});
