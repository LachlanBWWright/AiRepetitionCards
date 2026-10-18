"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { Alert } from "@recall/ui-web";
import { Effect, Either, Fiber, Schema } from "effect";
import type { SyncPushResponse } from "@recall/contracts";
import { AccountIdSchema, type AreaId, type AssessmentId } from "@recall/domain";
import {
  workspaceAccountFailureMessage,
  type WorkspaceSyncCheckpointFailure,
  type WorkspaceSyncTransport,
} from "@recall/application";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { createOwnerBoundWorkspaceMediaGateway } from "@/features/workspace/workspace-media-api";
import type { LearningArea, ReviewEvent, Workspace } from "@/features/workspace/types";
import { readWorkspaceSyncOwner, runWorkspaceSyncAction } from "./workspace-sync-action-workflow";
import { readBrowserSession } from "@/lib/auth/browser-session";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { apiFetch } from "@/lib/desktop-api";

export function WorkspaceSyncAction({
  workspace,
  autoSync = false,
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
  autoSync?: boolean;
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
    deletedCardIds: readonly AssessmentId[],
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
  const lastSyncedWorkspace = useRef<string | null>(null);
  const syncRef = useRef<() => void>(() => undefined);
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
  const [retrySignal, setRetrySignal] = useState(0);
  const missingReviewContentMessage =
    "A pending review refers to deleted content that this tab no longer contains. Download a backup or review snapshot before replacing it with an older backup containing that card. Pending changes remain in this tab; backups are not automatically merged.";
  const provisionCapacityMessage =
    "Cloud content and pending deleted-review content exceed this area's card or objective limits. Current tab changes remain in memory. Download a backup before changing cloud content to free capacity.";
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
    const isMounted = () => mounted;
    let lookupGeneration = 0;
    const refresh = () => {
      const generation = ++lookupGeneration;
      return Effect.runFork(
        readBrowserSession().pipe(
          Effect.tap((session) =>
            Effect.sync(() => {
              if (isMounted() && generation === lookupGeneration) publishOwner(session.ownerId);
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
    const transport: WorkspaceSyncTransport = (request) =>
      Effect.tryPromise({
        try: async () => {
          const response = await apiFetch(request.path, {
            method: request.method,
            headers: {
              ...request.headers,
              ...(request.body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          });
          return { status: response.status, body: (await response.json()) as unknown };
        },
        catch: () => ({ _tag: "WorkspaceSyncTransportFailure" }) as const,
      });
    runWorkspaceSyncAction({
      adoptLegacyOwner,
      demoMissingReviewContent,
      demoAccountState,
      busy,
      expectedOwner: ownerRef.current,
      startedEpoch: accountEpoch.current,
      currentEpoch: () => accountEpoch.current,
      publishOwner,
      setBusy,
      setMessage,
      setAccountFailure,
      setConflictData,
      lastSyncedWorkspace,
      autoSync,
      setRetrySignal,
      workspace,
      checkpoint,
      mediaStore: browserMediaStore,
      mediaGatewayForOwner: createOwnerBoundWorkspaceMediaGateway,
      transport,
      readSyncOwner: readWorkspaceSyncOwner,
      onSynced,
      onMissingReviewContent,
      onReviewProvisionCapacity,
      retainedCards,
      missingReviewContentMessage,
      provisionCapacityMessage,
    });
  }

  useEffect(() => {
    syncRef.current = () => {
      sync();
    };
  });

  useEffect(() => {
    if (!autoSync || !ownerId || demo || demoAccountState || demoMissingReviewContent) return;
    if (lastSyncedWorkspace.current === JSON.stringify(workspace)) return;
    const timer = window.setTimeout(() => {
      syncRef.current();
    }, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [autoSync, demo, demoAccountState, demoMissingReviewContent, ownerId, retrySignal, workspace]);

  if ((demo && !demoAccountState && !demoMissingReviewContent) || !enabled || !ownerId) return null;
  const messageIsError =
    visibleAccountFailure !== undefined ||
    (message !== null &&
      /could not|couldn't|failed|failure|unavailable|not applied|mismatch|cannot/i.test(message));
  const handleAdoptionConfirmation = (checked: boolean | "indeterminate") => {
    setAdoptionConfirmed(checked === true);
  };
  const handleClearConfirmation = (checked: boolean | "indeterminate") => {
    setClearConfirmed(checked === true);
  };
  const accountChangedMessage = workspaceAccountFailureMessage({
    _tag: "WorkspaceSyncFailure",
    reason: "account-changed",
  });
  const resolveContentConflict = () => {
    const preview = conflictData;
    if (!preview) return;
    Effect.runFork(
      readWorkspaceSyncOwner().pipe(
        Effect.match({
          onFailure: () => {
            setMessage("Account status could not be verified. The server preview was not applied.");
          },
          onSuccess: (verifiedOwner) => {
            publishOwner(verifiedOwner);
            if (verifiedOwner !== preview.ownerId || accountEpoch.current !== preview.epoch) {
              setConflictData(null);
              setMessage(accountChangedMessage);
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
                "Server history could not be replayed. The current tab's workspace was preserved.",
              );
              return;
            }
            setConflictData(null);
            setMessage("Server content loaded. Sync again to upload pending reviews.");
          },
        }),
      ),
    );
  };
  return (
    <div className="relative">
      <Button
        type="button"
        onClick={() => {
          sync();
        }}
        disabled={busy || visibleAccountFailure === "account-mismatch"}
      >
        {busy ? "Syncing…" : `Sync${pendingIds.length ? ` · ${String(pendingIds.length)}` : ""}`}
      </Button>
      <div
        className={
          visibleAccountFailure ||
          message === missingReviewContentMessage ||
          message === provisionCapacityMessage
            ? "absolute right-0 top-[calc(100%+12px)] z-20 grid w-[min(390px,85vw)] gap-3.5 rounded-xl border bg-card p-5 shadow-lg [&>div]:grid [&>div]:gap-3.5 [&_label]:text-xs [&_label]:leading-relaxed"
            : ""
        }
      >
        {retainedCards > 0 && (
          <Alert
            role="status"
            title="Deleted content is retained privately until its reviews and deletion acknowledgements have synced."
          >
            {retainedCards} deleted · awaiting review sync
          </Alert>
        )}
        {(message || visibleAccountFailure) && (
          <Alert
            role={messageIsError ? "alert" : "status"}
            variant={messageIsError ? "destructive" : "default"}
          >
            {message ??
              workspaceAccountFailureMessage({
                _tag: "WorkspaceSyncFailure",
                reason: visibleAccountFailure ?? "request",
              })}
          </Alert>
        )}
        {accountFailure === "owner-adoption-required" && (
          <div>
            <label htmlFor="workspace-adoption-confirmed">
              <Checkbox
                id="workspace-adoption-confirmed"
                checked={adoptionConfirmed}
                onCheckedChange={handleAdoptionConfirmation}
              />{" "}
              I confirm this older workspace belongs to the signed-in account.
            </label>
            <Button
              type="button"
              disabled={busy || !adoptionConfirmed}
              onClick={() => {
                sync(true);
              }}
            >
              Confirm ownership and sync
            </Button>
          </div>
        )}
        {visibleAccountFailure === "account-mismatch" && (
          <div>
            <Button type="button" onClick={onExportOffline}>
              Download tab backup
            </Button>
            <label htmlFor="workspace-clear-confirmed">
              <Checkbox
                id="workspace-clear-confirmed"
                checked={clearConfirmed}
                onCheckedChange={handleClearConfirmation}
              />{" "}
              Clear this tab’s working copy and attachments to continue with this account.
            </label>
            <Button type="button" disabled={busy || !clearConfirmed} onClick={onClearWorkspace}>
              Clear tab workspace
            </Button>
          </div>
        )}
      </div>
      {conflictData && (
        <Button type="button" onClick={resolveContentConflict}>
          Use server version
        </Button>
      )}
    </div>
  );
}
