import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Effect } from "effect";
import { WorkspaceContentPushRequestSchema } from "@recall/contracts";
import { WorkspaceSchema } from "@recall/domain";
import { syncWorkspace } from "@recall/application";
import { areaId, decode, server, workspace } from "./workspace-sync-fixtures";

await test("a persisted clean deck accepts remote edits automatically while overlapping local edits require review", () => {
  const remote = server();
  const input = (local: Parameters<typeof syncWorkspace>[0]["workspace"]) => {
    const base = remote.input(local);
    return {
      ...base,
      transport: (request: Parameters<typeof base.transport>[0]) => {
        if (request.path === "/api/v1/workspace" && request.method === "POST") {
          const body = decode(WorkspaceContentPushRequestSchema, request.body);
          if (
            body.areas.some((area) => {
              const existing = remote.documents.get(area.document.id);
              return existing && existing.contentHash !== area.baseContentHash;
            })
          )
            return Effect.succeed({ status: 409, body: { error: "content-conflict" } });
        }
        return base.transport(request);
      },
    };
  };
  const first = Effect.runSync(syncWorkspace(input(workspace([]))));
  assert.equal(first._tag, "Synced");
  if (first._tag !== "Synced") return;
  assert.ok(first.workspace.syncContentFingerprints?.[areaId]);
  const restored = decode(WorkspaceSchema, JSON.parse(JSON.stringify(first.workspace)));
  const initial = remote.documents.get(areaId);
  assert.ok(initial);
  const document = { ...initial.document, title: "Changed on another device" };
  remote.documents.set(areaId, {
    ...initial,
    document,
    contentHash: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
  });
  const pulled = Effect.runSync(syncWorkspace(input(restored)));
  assert.equal(pulled._tag, "Synced");
  if (pulled._tag !== "Synced") return;
  assert.equal(pulled.workspace.areas[0]?.title, document.title);
  assert.equal(remote.documents.get(areaId)?.document.title, document.title);
  const edited = {
    ...pulled.workspace,
    areas: pulled.workspace.areas.map((area) => ({ ...area, title: "New local edit" })),
  };
  const next = { ...document, title: "A concurrent remote edit" };
  remote.documents.set(areaId, {
    ...initial,
    document: next,
    contentHash: createHash("sha256").update(JSON.stringify(next)).digest("hex"),
  });
  const conflict = Effect.runSync(syncWorkspace(input(edited)));
  assert.equal(conflict._tag, "ContentConflict");
  assert.equal(edited.areas[0]?.title, "New local edit");
  assert.equal(remote.documents.get(areaId)?.document.title, next.title);
});
