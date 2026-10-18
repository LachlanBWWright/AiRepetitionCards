import { Effect, Schema } from "effect";
import type { SyncPushResponse } from "@recall/contracts";
import { AccountIdSchema, type AreaId, type AssessmentId } from "@recall/domain";
import {
  syncWorkspace,
  workspaceAccountFailureMessage,
  type WorkspaceSyncCheckpointFailure,
  type WorkspaceSyncTransport,
} from "@recall/application";
import type { LearningArea, ReviewEvent, Workspace } from "@/features/workspace/types";
import { readBrowserSession } from "@/lib/auth/browser-session";

type SyncOwnerEffect = Effect.Effect<string | null, { readonly _tag: "SyncAuthLookupError" }>;
type ConflictData = {
  readonly ownerId: string;
  readonly epoch: number;
  readonly areas: readonly LearningArea[];
  readonly hashes: Readonly<Record<string, string>>;
  readonly deletedAreaIds: readonly AreaId[];
};

export function readWorkspaceSyncOwner(): SyncOwnerEffect {
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

export function runWorkspaceSyncAction(args: {
  readonly adoptLegacyOwner: boolean;
  readonly demoMissingReviewContent: boolean;
  readonly demoAccountState?:
    "account-mismatch" | "owner-adoption-required" | "ownership-checkpoint" | undefined;
  readonly busy: boolean;
  readonly expectedOwner: string | null;
  readonly startedEpoch: number;
  readonly currentEpoch: () => number;
  readonly publishOwner: (ownerId: string | null) => void;
  readonly setBusy: (busy: boolean) => void;
  readonly setMessage: (message: string | null) => void;
  readonly setAccountFailure: (
    failure: "account-mismatch" | "owner-adoption-required" | "ownership-checkpoint" | undefined,
  ) => void;
  readonly setConflictData: (data: ConflictData | null) => void;
  readonly lastSyncedWorkspace: { current: string | null };
  readonly autoSync: boolean;
  readonly setRetrySignal: (update: (value: number) => number) => void;
  readonly workspace: Workspace;
  readonly checkpoint: (
    workspace: Workspace,
  ) => Effect.Effect<Workspace, WorkspaceSyncCheckpointFailure>;
  readonly mediaStore: Parameters<typeof syncWorkspace>[0]["mediaStore"];
  readonly mediaGatewayForOwner: Parameters<typeof syncWorkspace>[0]["mediaGatewayForOwner"];
  readonly transport: WorkspaceSyncTransport;
  readonly readSyncOwner: () => SyncOwnerEffect;
  readonly onSynced: (
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
  readonly onMissingReviewContent?: (() => void) | undefined;
  readonly onReviewProvisionCapacity?: (() => void) | undefined;
  readonly retainedCards: number;
  readonly missingReviewContentMessage: string;
  readonly provisionCapacityMessage: string;
}): void {
  const {
    adoptLegacyOwner,
    demoMissingReviewContent,
    demoAccountState,
    busy,
    expectedOwner,
    startedEpoch,
    currentEpoch,
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
    mediaStore,
    mediaGatewayForOwner,
    transport,
    readSyncOwner,
    onSynced,
    onMissingReviewContent,
    onReviewProvisionCapacity,
    retainedCards,
    missingReviewContentMessage,
    provisionCapacityMessage,
  } = args;
  if (demoMissingReviewContent) {
    setMessage(missingReviewContentMessage);
    return;
  }
  if (demoAccountState) {
    setMessage("Mock account ownership controls are ready for review.");
    return;
  }
  if (busy || !expectedOwner) return;
  setBusy(true);
  setMessage(null);
  const authenticatedRequest = readSyncOwner().pipe(
    Effect.tap((verifiedOwner) =>
      Effect.sync(() => {
        publishOwner(verifiedOwner);
      }),
    ),
  );
  const now = new Date();
  const program = authenticatedRequest.pipe(
    Effect.flatMap((verifiedOwner) =>
      verifiedOwner === expectedOwner && startedEpoch === currentEpoch()
        ? syncWorkspace({
            workspace,
            now,
            createId: () => crypto.randomUUID(),
            transport,
            mediaStore,
            mediaGatewayForOwner,
            checkpoint,
            adoptLegacyOwner,
            expectedOwnerId: expectedOwner,
          })
        : Effect.fail({ _tag: "WorkspaceSyncFailure", reason: "account-changed" } as const),
    ),
    Effect.flatMap((result) =>
      readSyncOwner().pipe(
        Effect.tap((verifiedOwner) =>
          Effect.sync(() => {
            publishOwner(verifiedOwner);
          }),
        ),
        Effect.flatMap((verifiedOwner) =>
          verifiedOwner === expectedOwner && startedEpoch === currentEpoch()
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
        let message =
          "Sync failed. Changes exist only in this tab until the server confirms them; retry before leaving.";
        if (
          error._tag === "WorkspaceSyncFailure" &&
          error.reason === "deleted-review-content-missing"
        ) {
          message = missingReviewContentMessage;
        } else if (
          error._tag === "WorkspaceSyncFailure" &&
          error.reason === "deleted-review-provision-capacity"
        ) {
          message = provisionCapacityMessage;
        } else if (
          error._tag === "WorkspaceSyncFailure" &&
          (error.reason === "content" || error.reason === "media")
        ) {
          message =
            "Decks could not sync. Changes remain only in this tab until the server confirms them.";
        }
        setMessage(message);
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
            "A deck changed on another device. Review the server version before continuing.",
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
          setMessage("Review history could not be replayed. Changes remain only in this tab.");
          return;
        }
        lastSyncedWorkspace.current = JSON.stringify(applied);
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
          lastSyncedWorkspace.current = null;
          setMessage("Your newer local edits were preserved. Sync again to upload them.");
          return;
        }
        if (result.hasMore) {
          lastSyncedWorkspace.current = null;
          setMessage("Sync progress saved. More remote changes remain; sync again to continue.");
          return;
        }
        if (result.uploadDeferred) {
          lastSyncedWorkspace.current = null;
          setMessage(
            retainedCards > 0
              ? "Reviews and deletion acknowledgements are still syncing. Deleted content stays hidden; sync again to finish."
              : "Sync progress received. Sync again to finish content and local uploads.",
          );
          return;
        }
        if (result.remainingPendingReviews > 0 && result.conflicts.length === 0) {
          lastSyncedWorkspace.current = null;
          setMessage(
            `Sync progress saved. ${String(result.remainingPendingReviews)} pending review${result.remainingPendingReviews === 1 ? " remains" : "s remain"}; sync again to continue.`,
          );
          return;
        }
        const { acceptedIds, conflicts } = result;
        setMessage(
          conflicts.length > 0
            ? `${String(conflicts.length)} review conflict${conflicts.length === 1 ? " was" : "s were"} rebased. Sync again to finish.`
            : acceptedIds.length === 0
              ? result.pulledEvents.length === 0
                ? "Everything is up to date."
                : `${String(result.pulledEvents.length)} review${result.pulledEvents.length === 1 ? "" : "s"} received.`
              : `${String(acceptedIds.length)} review${acceptedIds.length === 1 ? "" : "s"} synced${result.pulledEvents.length ? ` · ${String(result.pulledEvents.length)} received` : ""}.`,
        );
      },
    }),
    Effect.ensuring(
      Effect.sync(() => {
        setBusy(false);
        if (autoSync) {
          window.setTimeout(() => {
            setRetrySignal((value) => value + 1);
          }, 3_000);
        }
      }),
    ),
  );
  Effect.runFork(program);
}
