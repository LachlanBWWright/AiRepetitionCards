import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  createAreaId,
  createObjectiveId,
  type LearningActivity,
  type LearningAttempt,
  type Workspace,
} from "@recall/domain";
import { exportWorkspaceBackupPackage, importWorkspaceBackupPackage } from "@recall/application";

const at = "2026-10-13T09:00:00.000Z";
const areaId = createAreaId("00000000-0000-4000-8000-000000000901");
const objectiveId = createObjectiveId("00000000-0000-4000-8000-000000000902");
const activity: LearningActivity = {
  id: "custom-exercise",
  areaId,
  title: "Future activity",
  pluginId: "third-party.future-plugin",
  pluginVersion: 7,
  revision: 1,
  objectiveIds: [objectiveId],
  fallback: "Explain the relationship in your own words.",
  payload: { diagram: { nodes: ["A", "B"], weights: [0.25, null] }, enabled: true },
};
const attempt: LearningAttempt = {
  id: "accepted-attempt",
  activity,
  response: {
    answers: ["A influences B"],
    selectedOptionIds: [],
    selfScore: 0.5,
    assistance: "none",
  },
  result: {
    evidence: [
      {
        objectiveId,
        dimension: "reasoning",
        score: 0.75,
        confidence: 0.8,
        assistance: "none",
        assessment: "human",
        explanation: "The relationship was explained.",
      },
    ],
    feedback: "Consider a counterexample next.",
    evaluatorId: "human-rubric",
    evaluatorVersion: "1",
  },
  startedAt: at,
  submittedAt: at,
  acceptedAt: at,
};
const workspace: Workspace = {
  schemaVersion: 1,
  areas: [
    {
      id: areaId,
      title: "Relationships",
      color: "#112233",
      cards: [],
      objectives: [
        {
          id: objectiveId,
          title: "Understand relationships",
          description: null,
          prerequisiteIds: [],
        },
      ],
    },
  ],
  reviews: 0,
  reviewEvents: [],
  activityLibrary: {
    version: 1,
    activities: [
      { ...activity, revision: 2, payload: { ...activity.payload, added: "new revision" } },
    ],
    attempts: [attempt],
    drafts: [
      {
        id: "unfinished-attempt",
        activity,
        response: { ...attempt.response, answers: ["Partial answer"] },
        stage: 0,
        startedAt: at,
        updatedAt: at,
      },
    ],
    editorDrafts: [
      {
        id: "unfinished-editor",
        areaId,
        title: "",
        pluginId: activity.pluginId,
        objectiveId,
        fields: { prompt: "Incomplete prompt" },
        updatedAt: at,
      },
    ],
  },
};
const emptyMediaStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed([]),
};
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}

void test("private backups preserve unknown plugin payloads, accepted revisions and unfinished work", () => {
  const before = JSON.stringify(workspace);
  const archive = success(exportWorkspaceBackupPackage(workspace, at, emptyMediaStore));
  const restored = success(importWorkspaceBackupPackage(archive));
  assert.deepEqual(restored.workspace, workspace);
  assert.deepEqual(restored.media, []);
  assert.equal(JSON.stringify(workspace), before);
  const library = restored.workspace.activityLibrary;
  assert.ok(library);
  assert.equal(library.attempts[0]?.activity.revision, 1);
  assert.equal(library.activities[0]?.revision, 2);
});

function archiveWithWorkspace(input: unknown): Uint8Array {
  const files = unzipSync(success(exportWorkspaceBackupPackage(workspace, at, emptyMediaStore)));
  const bytes = strToU8(JSON.stringify(input));
  const digest = Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
  files["workspace.json"] = bytes;
  // Rebuild the authentic manifest shape with matching hashes, so rejection tests
  // exercise workspace validation rather than detecting archive tampering first.
  const index = files["media/index.json"];
  assert.ok(index);
  files["manifest.json"] = strToU8(
    JSON.stringify({
      backupVersion: 2,
      exportedAt: at,
      workspaceSha256: digest,
      files: [
        { path: "workspace.json", sha256: digest },
        {
          path: "media/index.json",
          sha256: Array.from(sha256(index), (value) => value.toString(16).padStart(2, "0")).join(
            "",
          ),
        },
      ],
      media: [],
    }),
  );
  return zipSync(files);
}

void test("backup import rejects invalid assessment evidence even with valid archive hashes", () => {
  const archive = archiveWithWorkspace({
    ...workspace,
    activityLibrary: {
      ...workspace.activityLibrary,
      attempts: [
        {
          ...attempt,
          result: {
            ...attempt.result,
            evidence: attempt.result.evidence.map((entry) => ({ ...entry, score: 1.5 })),
          },
        },
      ],
    },
  });
  const result = Effect.runSync(Effect.either(importWorkspaceBackupPackage(archive)));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "invalid-backup");
});

void test("backup import rejects duplicate immutable attempt identities", () => {
  const archive = archiveWithWorkspace({
    ...workspace,
    activityLibrary: { ...workspace.activityLibrary, attempts: [attempt, attempt] },
  });
  const result = Effect.runSync(Effect.either(importWorkspaceBackupPackage(archive)));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "invalid-backup");
});
