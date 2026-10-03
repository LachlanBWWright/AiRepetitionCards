"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Effect, Either, Fiber, Schema } from "effect";
import type { SyncPushResponse } from "@recall/contracts";
import { AccountIdSchema, type AreaId, type CardId } from "@recall/domain";
import {
  syncWorkspace,
  workspaceAccountFailureMessage,
  type WorkspaceSyncTransport,
  type WorkspaceSyncCheckpointFailure,
} from "@recall/application";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { createOwnerBoundWorkspaceMediaGateway } from "@/features/workspace/workspace-media-api";
import type { LearningArea, ReviewEvent, Workspace } from "@/features/workspace/types";
import { readBrowserSession } from "@/lib/auth/browser-session";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { apiFetch } from "@/lib/desktop-api";

function readSyncOwner(): Effect.Effect<string | null, { readonly _tag: "SyncAuthLookupError" }> {
  const desktop = window.recallDesktop;
  if (!desktop)
    return readBrowserSession().pipe(
      Effect.map((session) => session.ownerId),
      Effect.mapError(() => ({ _tag: "SyncAuthLookupError" }) as const),
    );
  return Effect.tryPromise({
    try: () => desktop.auth.getStatus(),
    catch: () => ({ _tag: "SyncAuthLookupError" }) as const,
  }).pipe(
    Effect.flatMap((input) =>
      Schema.decodeUnknown(
        Schema.Struct({
          _tag: Schema.Literal("Success"),
          value: Schema.Struct({ ownerId: Schema.NullOr(AccountIdSchema) }),
        }),
      )(input),
    ),
    Effect.map((status) => status.value.ownerId),
    Effect.mapError(() => ({ _tag: "SyncAuthLookupError" }) as const),
  );
}

export function WorkspaceSyncAction({
  workspace,
  demo = false,
  onSynced,
  onContentConflict,
  checkpoint,
  onExportOffline,
  onClearWorkspace,
  demoAccountState,
  demoMissingReviewContent = false,
  onMissingReviewContent,
  onReviewProvisionCapacity,
}: {
  workspace: Workspace;
  demo?: boolean;
  checkpoint: (workspace: Workspace) => Effect.Effect<Workspace, WorkspaceSyncCheckpointFailure>;
  onExportOffline: () => void;
  onClearWorkspace: () => void;
  demoAccountState?: "account-mismatch" | "owner-adoption-required" | "ownership-checkpoint";
  demoMissingReviewContent?: boolean;
  onMissingReviewContent?: () => void;
  onReviewProvisionCapacity?: () => void;
  onSynced: (
    acceptedIds: readonly string[],
    cursor: string,
    pulledEvents: readonly ReviewEvent[],
    pulledAreas: readonly LearningArea[],
    deletedCardIds: readonly CardId[],
    syncedAreaTombstoneIds: readonly AreaId[],
    pulledDeletedAreaIds: readonly AreaId[],
    contentHashes: Readonly<Record<string, string>>,
    conflicts: SyncPushResponse["conflicts"],
    hasMore: boolean,
    uploadDeferred: boolean,
    baseline: Workspace,
  ) => Workspace | null;
  onContentConflict: (
    ownerId: string,
    areas: readonly LearningArea[],
    hashes: Readonly<Record<string, string>>,
    deletedAreaIds: readonly AreaId[],
  ) => boolean;
}) {
  const [ownerId, setOwnerId] = useState<string | null>(
    demoAccountState || demoMissingReviewContent ? "12345678-1234-4234-8234-123456789abc" : null,
  );
  const ownerRef = useRef(ownerId);
  const accountEpoch = useRef(0);
  const [accountFailure, setAccountFailure] = useState<typeof demoAccountState>(demoAccountState);
  const [adoptionConfirmed, setAdoptionConfirmed] = useState(false);
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const visibleAccountFailure =
    accountFailure ??
    (workspace.syncOwnerId && ownerId && workspace.syncOwnerId !== ownerId
      ? "account-mismatch"
      : undefined);
  const [busy, setBusy] = useState(false);
  const missingReviewContentMessage =
    "A pending review refers to deleted content that this older workspace no longer contains. Export this device's current private backup or review snapshot before replacing it with an older backup containing that card. Your reviews remain saved; backups are not automatically merged.";
  const provisionCapacityMessage =
    "Cloud content and pending deleted-review content exceed this area's card or objective limits. Local cards and reviews remain saved. Export a private backup before changing cloud content to free capacity.";
  const [message, setMessage] = useState<string | null>(
    demoMissingReviewContent ? missingReviewContentMessage : null,
  );
  const [conflictData, setConflictData] = useState<{
    readonly ownerId: string;
    readonly epoch: number;
    readonly areas: readonly LearningArea[];
    readonly hashes: Readonly<Record<string, string>>;
    readonly deletedAreaIds: readonly AreaId[];
  } | null>(null);
  const enabled =
    Boolean(demoAccountState) || demoMissingReviewContent || readSupabaseConfig()._tag === "Right";
  const publishOwner = useCallback((next: string | null) => {
    if (ownerRef.current !== next) {
      accountEpoch.current += 1;
      ownerRef.current = next;
      setConflictData(null);
      setMessage(null);
      setAccountFailure(undefined);
      setAdoptionConfirmed(false);
      setClearConfirmed(false);
    }
    setOwnerId(next);
  }, []);
  const pendingIds = workspace.pendingReviewEventIds ?? [];
  const retainedCards = (workspace.retainedReviewAreas ?? []).flatMap((area) => area.cards).length;

  useEffect(() => {
    if (demo) return;
    const desktop = window.recallDesktop;
    if (desktop) {
      let mounted = true;
      let changed = false;
      const publish = (input: unknown) => {
        if (typeof input !== "object" || input === null || !("value" in input)) return;
        const decoded = Schema.decodeUnknownEither(
          Schema.Struct({ configured: Schema.Boolean, ownerId: Schema.NullOr(AccountIdSchema) }),
        )(input.value);
        if (Either.isRight(decoded) && mounted) publishOwner(decoded.right.ownerId);
      };
      void Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () => desktop.auth.getStatus(),
            catch: () => ({ _tag: "SyncAuthLookupError" }) as const,
          }),
        ),
      ).then((result) => {
        if (Either.isRight(result) && !changed) publish(result.right);
      });
      const unsubscribe = desktop.auth.onStateChanged((input) => {
        changed = true;
        const decoded = Schema.decodeUnknownEither(
          Schema.Struct({ ownerId: Schema.NullOr(AccountIdSchema) }),
        )(input);
        if (Either.isRight(decoded) && mounted) publishOwner(decoded.right.ownerId);
      });
      return () => {
        mounted = false;
        unsubscribe();
      };
    }
    let mounted = true;
    let lookupGeneration = 0;
    const refresh = () => {
      const generation = ++lookupGeneration;
      return Effect.runFork(
        readBrowserSession().pipe(
          Effect.tap((session) =>
            Effect.sync(() => {
              if (mounted && generation === lookupGeneration) publishOwner(session.ownerId);
            }),
          ),
          Effect.ignore,
        ),
      );
    };
    const fiber = refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [demo, publishOwner]);

  function sync(adoptLegacyOwner = false) {
    if (demoMissingReviewContent) {
      setMessage(missingReviewContentMessage);
      return;
    }
    if (demoAccountState) {
      setMessage("Mock account ownership controls are ready for review.");
      return;
    }
    if (busy) return;
    const expectedOwner = ownerRef.current;
    if (!expectedOwner) return;
    const startedEpoch = accountEpoch.current;
    setBusy(true);
    setMessage(null);
    const transport: WorkspaceSyncTransport = (request) =>
      Effect.tryPromise({
        try: async () => {
          const response = await apiFetch(request.path, {
            method: request.method,
            headers: {
              ...request.headers,
              ...(request.body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(request.body === undefined
              ? {}
              : {
                  body: JSON.stringify(request.body),
                }),
          });
          return { status: response.status, body: (await response.json()) as unknown };
        },
        catch: () => ({ _tag: "WorkspaceSyncTransportFailure" }) as const,
      });
    const authenticatedRequest = readSyncOwner().pipe(
      Effect.tap((verifiedOwner) => Effect.sync(() => publishOwner(verifiedOwner))),
    );
    const now = new Date();
    const program = authenticatedRequest.pipe(
      Effect.flatMap((verifiedOwner) =>
        verifiedOwner === expectedOwner && startedEpoch === accountEpoch.current
          ? syncWorkspace({
              workspace,
              now,
              createId: () => crypto.randomUUID(),
              transport,
              mediaStore: browserMediaStore,
              mediaGatewayForOwner: createOwnerBoundWorkspaceMediaGateway,
              checkpoint,
              adoptLegacyOwner,
              expectedOwnerId: expectedOwner,
            })
          : Effect.fail({ _tag: "WorkspaceSyncFailure", reason: "account-changed" } as const),
      ),
      Effect.flatMap((result) =>
        readSyncOwner().pipe(
          Effect.tap((verifiedOwner) => Effect.sync(() => publishOwner(verifiedOwner))),
          Effect.flatMap((verifiedOwner) =>
            verifiedOwner === expectedOwner && startedEpoch === accountEpoch.current
              ? Effect.succeed(result)
              : Effect.fail({ _tag: "WorkspaceSyncFailure", reason: "account-changed" } as const),
          ),
        ),
      ),
      Effect.match({
        onFailure: (error) => {
          if (
            error._tag === "WorkspaceSyncFailure" &&
            error.reason === "deleted-review-content-missing"
          )
            onMissingReviewContent?.();
          if (
            error._tag === "WorkspaceSyncFailure" &&
            error.reason === "deleted-review-provision-capacity"
          )
            onReviewProvisionCapacity?.();
          if (
            error._tag === "WorkspaceSyncFailure" &&
            (error.reason === "account-mismatch" ||
              error.reason === "owner-adoption-required" ||
              error.reason === "ownership-checkpoint")
          )
            setAccountFailure(error.reason);
          if (
            error._tag === "WorkspaceSyncFailure" &&
            (error.reason === "account-mismatch" ||
              error.reason === "owner-adoption-required" ||
              error.reason === "ownership-checkpoint" ||
              error.reason === "account-changed")
          ) {
            setMessage(workspaceAccountFailureMessage(error));
            return;
          }
          setMessage(
            error._tag === "WorkspaceSyncFailure" &&
              error.reason === "deleted-review-content-missing"
              ? missingReviewContentMessage
              : error._tag === "WorkspaceSyncFailure" &&
                  error.reason === "deleted-review-provision-capacity"
                ? provisionCapacityMessage
                : error._tag === "WorkspaceSyncFailure" &&
                    (error.reason === "content" || error.reason === "media")
                  ? "Knowledge Areas could not sync. Your reviews are still saved on this device."
                  : "Sync failed. Your reviews are still saved on this device.",
          );
        },
        onSuccess: (result) => {
          setAccountFailure(undefined);
          if (result._tag === "ContentConflict") {
            setConflictData({
              ownerId: result.ownerId,
              epoch: startedEpoch,
              areas: result.areas,
              hashes: result.hashes,
              deletedAreaIds: result.deletedAreaIds,
            });
            setMessage(
              "A Knowledge Area changed on another device. Review the server version before continuing.",
            );
            return;
          }
          const applied = onSynced(
            result.acceptedIds,
            result.cursor,
            result.pulledEvents,
            result.pulledAreas,
            result.deletedCardIds,
            result.syncedAreaTombstoneIds,
            result.pulledDeletedAreaIds,
            result.contentHashes,
            result.conflicts,
            result.hasMore,
            result.uploadDeferred,
            result.baseline,
          );
          if (!applied) {
            setMessage("Review history could not be replayed. Your local workspace remains saved.");
            return;
          }
          setConflictData(null);
          if ((applied.syncContentConflictAreaIds ?? []).length > 0) {
            setMessage(
              "Your newer local edits were preserved. Sync again to review conflicting server content.",
            );
            return;
          }
          if (
            (applied.syncPendingContentAreaIds ?? []).length > 0 &&
            !result.hasMore &&
            !result.uploadDeferred
          ) {
            setMessage("Your newer local edits were preserved. Sync again to upload them.");
            return;
          }
          if (result.hasMore) {
            setMessage("Sync progress saved. More remote changes remain; sync again to continue.");
            return;
          }
          if (result.uploadDeferred) {
            setMessage(
              retainedCards > 0
                ? "Reviews and deletion acknowledgements are still syncing. Deleted content stays hidden; sync again to finish."
                : "Sync progress received. Sync again to finish content and local uploads.",
            );
            return;
          }
          if (result.remainingPendingReviews > 0 && result.conflicts.length === 0) {
            setMessage(
              `Sync progress saved. ${result.remainingPendingReviews} pending review${result.remainingPendingReviews === 1 ? " remains" : "s remain"}; sync again to continue.`,
            );
            return;
          }
          const { acceptedIds, conflicts } = result;
          setMessage(
            conflicts.length > 0
              ? `${conflicts.length} review conflict${conflicts.length === 1 ? " was" : "s were"} rebased on this device. Sync again to finish.`
              : acceptedIds.length === 0
                ? result.pulledEvents.length === 0
                  ? "Everything is up to date."
                  : `${result.pulledEvents.length} review${result.pulledEvents.length === 1 ? "" : "s"} received.`
                : `${acceptedIds.length} review${acceptedIds.length === 1 ? "" : "s"} synced${result.pulledEvents.length ? ` · ${result.pulledEvents.length} received` : ""}.`,
          );
        },
      }),
      Effect.ensuring(Effect.sync(() => setBusy(false))),
    );
    Effect.runFork(program);
  }

  if ((demo && !demoAccountState && !demoMissingReviewContent) || !enabled || !ownerId) return null;
  return (
    <div className="workspace-sync-action">
      <button
        className="text-button"
        type="button"
        onClick={() => sync()}
        disabled={busy || visibleAccountFailure === "account-mismatch"}
      >
        {busy ? "Syncing…" : `Sync${pendingIds.length ? ` · ${pendingIds.length}` : ""}`}
      </button>
      <div
        className={
          visibleAccountFailure ||
          message === missingReviewContentMessage ||
          message === provisionCapacityMessage
            ? "workspace-sync-account-notice"
            : "workspace-sync-feedback"
        }
      >
        {retainedCards > 0 && (
          <span
            className="saved-state"
            title="Deleted content is retained privately until its reviews and deletion acknowledgements have synced."
          >
            {retainedCards} deleted · awaiting review sync
          </span>
        )}
        {(message || visibleAccountFailure) && (
          <span className="saved-state" role="status">
            {message ??
              workspaceAccountFailureMessage({
                _tag: "WorkspaceSyncFailure",
                reason: visibleAccountFailure ?? "request",
              })}
          </span>
        )}
        {accountFailure === "owner-adoption-required" && (
          <div>
            <label>
              <input
                type="checkbox"
                checked={adoptionConfirmed}
                onChange={(event) => setAdoptionConfirmed(event.target.checked)}
              />{" "}
              I confirm this older workspace belongs to the signed-in account.
            </label>
            <button
              className="text-button"
              type="button"
              disabled={busy || !adoptionConfirmed}
              onClick={() => sync(true)}
            >
              Confirm ownership and sync
            </button>
          </div>
        )}
        {visibleAccountFailure === "account-mismatch" && (
          <div>
            <button className="text-button" type="button" onClick={onExportOffline}>
              Export offline backup
            </button>
            <label>
              <input
                type="checkbox"
                checked={clearConfirmed}
                onChange={(event) => setClearConfirmed(event.target.checked)}
              />{" "}
              Clear this device workspace and attachments to start fresh.
            </label>
            <button
              className="text-button"
              type="button"
              disabled={busy || !clearConfirmed}
              onClick={onClearWorkspace}
            >
              Clear device workspace
            </button>
          </div>
        )}
      </div>
      {conflictData && (
        <button
          className="text-button"
          type="button"
          onClick={() => {
            const preview = conflictData;
            Effect.runFork(
              readSyncOwner().pipe(
                Effect.match({
                  onFailure: () =>
                    setMessage(
                      "Account status could not be verified. The server preview was not applied.",
                    ),
                  onSuccess: (verifiedOwner) => {
                    publishOwner(verifiedOwner);
                    if (
                      verifiedOwner !== preview.ownerId ||
                      accountEpoch.current !== preview.epoch
                    ) {
                      setConflictData(null);
                      setMessage(
                        workspaceAccountFailureMessage({
                          _tag: "WorkspaceSyncFailure",
                          reason: "account-changed",
                        }),
                      );
                      return;
                    }
                    const applied = onContentConflict(
                      preview.ownerId,
                      preview.areas,
                      preview.hashes,
                      preview.deletedAreaIds,
                    );
                    if (!applied) {
                      setMessage(
                        "Server history could not be replayed. Your local workspace remains saved.",
                      );
                      return;
                    }
                    setConflictData(null);
                    setMessage("Server content loaded. Sync again to upload pending reviews.");
                  },
                }),
              ),
            );
          }}
        >
          Use server version
        </button>
      )}
    </div>
  );
}
