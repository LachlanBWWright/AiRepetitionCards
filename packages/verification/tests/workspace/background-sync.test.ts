import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { applyWorkspaceSyncChanges } from "@recall/application";
import { runWorkspaceSyncAction } from "../../../../apps/web/src/components/auth/workspace-sync-action-workflow";
import { owner, server, uuid, workspace } from "./workspace-sync-fixtures";

await test("background sync uploads pending reviews quietly and retries a temporary transport failure", async () => {
  const remote = server();
  let current = workspace();
  const input = remote.input(current);
  const pendingCount = () => current.pendingReviewEventIds?.length ?? 0;
  const settled = { current: null as string | null };
  const messages: (string | null)[] = [];
  let retryRequests = 0;
  let offline = true;
  const run = () =>
    Effect.runPromise(
      runWorkspaceSyncAction({
        adoptLegacyOwner: false,
        demoMissingReviewContent: false,
        busy: false,
        expectedOwner: owner,
        startedEpoch: 0,
        currentEpoch: () => 0,
        publishOwner: () => undefined,
        setBusy: () => undefined,
        setMessage: (message) => {
          messages.push(message);
        },
        setAccountFailure: () => undefined,
        setConflictData: (data) => {
          assert.equal(data, null);
        },
        lastSyncedWorkspace: settled,
        scheduleRetry: () => {
          retryRequests += 1;
        },
        workspace: current,
        checkpoint: (bound) =>
          input.checkpoint(bound).pipe(
            Effect.tap((saved) =>
              Effect.sync(() => {
                current = saved;
              }),
            ),
          ),
        mediaStore: input.mediaStore,
        mediaGatewayForOwner: input.mediaGatewayForOwner,
        transport: (request) =>
          offline
            ? Effect.fail({ _tag: "WorkspaceSyncTransportFailure" })
            : input.transport(request),
        readSyncOwner: () => Effect.succeed(owner),
        onSynced: (
          acceptedIds,
          cursor,
          pulledEvents,
          pulledAreas,
          deletedCardIds,
          syncedAreaTombstoneIds,
          pulledDeletedAreaIds,
          contentHashes,
          conflicts,
          hasMore,
          uploadDeferred,
          baseline,
          studyDocument,
          studyConflict,
        ) => {
          current = Effect.runSync(
            applyWorkspaceSyncChanges(
              current,
              {
                acceptedIds,
                cursor,
                pulledEvents,
                pulledAreas,
                deletedCardIds,
                syncedAreaTombstoneIds,
                pulledDeletedAreaIds,
                contentHashes,
                conflicts,
                hasMore,
                uploadDeferred,
                baseline,
                ...(studyDocument ? { studyDocument } : {}),
                ...(studyConflict ? { studyConflict } : {}),
              },
              () => uuid(99),
            ),
          );
          return current;
        },
        missingReviewContentMessage: "Missing review content",
        provisionCapacityMessage: "Review content exceeds capacity",
      }),
    );
  await run();
  assert.equal(remote.reviews.size, 0);
  assert.equal(pendingCount(), 1);
  assert.equal(retryRequests, 1);
  assert.match(messages.at(-1) ?? "", /Retrying automatically/);
  offline = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await run();
    if (pendingCount() === 0) break;
  }
  assert.ok(remote.reviews.size >= 1);
  assert.equal(pendingCount(), 0);
  assert.equal(settled.current, JSON.stringify(current));
  assert.equal(messages.at(-1), null);
  assert.ok(retryRequests >= 2);
});
