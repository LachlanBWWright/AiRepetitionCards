"use client";

import { useEffect, useState } from "react";
import { Effect, Either, Fiber, Schema } from "effect";
import {
  DeletedAreaIdsSchema,
  SyncPullResponseSchema,
  SyncReviewOperationSchema,
  SyncPushResponseSchema,
  type SyncPushResponse,
  type SyncReviewOperation,
} from "@recall/contracts";
import { KnowledgeAreaSchema, ReviewEventSchema } from "@recall/domain";
import type { LearningArea, ReviewEvent, Workspace } from "@/features/workspace/types";
import { fromKnowledgeArea, toKnowledgeArea } from "@/features/workspace/knowledge-area-json";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { apiFetch } from "@/lib/desktop-api";

const WorkspaceSnapshotSchema = Schema.Struct({
  deletedAreaIds: DeletedAreaIdsSchema,
  areas: Schema.Array(
    Schema.Struct({
      document: KnowledgeAreaSchema,
      color: Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i)),
      contentHash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i)),
    }),
  ),
});

export function WorkspaceSyncAction({
  workspace,
  demo = false,
  onSynced,
  onContentConflict,
}: {
  workspace: Workspace;
  demo?: boolean;
  onSynced: (
    acceptedIds: readonly string[],
    cursor: string,
    pulledEvents: readonly ReviewEvent[],
    pulledAreas: readonly LearningArea[],
    deletedCardIds: readonly string[],
    syncedAreaTombstoneIds: readonly string[],
    pulledDeletedAreaIds: readonly string[],
    contentHashes: Readonly<Record<string, string>>,
    conflicts: SyncPushResponse["conflicts"],
  ) => void;
  onContentConflict: (
    areas: readonly LearningArea[],
    hashes: Readonly<Record<string, string>>,
    deletedAreaIds: readonly string[],
  ) => void;
}) {
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflictData, setConflictData] = useState<{
    readonly areas: readonly LearningArea[];
    readonly hashes: Readonly<Record<string, string>>;
    readonly deletedAreaIds: readonly string[];
  } | null>(null);
  const enabled = readSupabaseConfig()._tag === "Right";
  const pendingIds = workspace.pendingReviewEventIds ?? [];
  const pendingAreaTombstones = (workspace.deletedAreas ?? []).filter(
    (item) => !item.synced && item.baseContentHash,
  );

  useEffect(() => {
    if (demo) return;
    const desktop = window.recallDesktop;
    if (desktop) {
      let mounted = true;
      const publish = (input: unknown) => {
        if (typeof input !== "object" || input === null || !("value" in input)) return;
        const decoded = Schema.decodeUnknownEither(
          Schema.Struct({ configured: Schema.Boolean, email: Schema.NullOr(Schema.String) }),
        )(input.value);
        if (Either.isRight(decoded) && mounted) setAuthenticated(Boolean(decoded.right.email));
      };
      void Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () => desktop.auth.getStatus(),
            catch: () => ({ _tag: "SyncAuthLookupError" }) as const,
          }),
        ),
      ).then((result) => {
        if (Either.isRight(result)) publish(result.right);
      });
      const unsubscribe = desktop.auth.onStateChanged((input) => {
        const decoded = Schema.decodeUnknownEither(
          Schema.Struct({ email: Schema.NullOr(Schema.String) }),
        )(input);
        if (Either.isRight(decoded) && mounted) setAuthenticated(Boolean(decoded.right.email));
      });
      return () => {
        mounted = false;
        unsubscribe();
      };
    }
    const client = createSupabaseBrowserClient();
    if (!client) return;
    let mounted = true;
    const lookup = Effect.tryPromise({
      try: () => client.auth.getUser(),
      catch: () => ({ _tag: "SyncAuthLookupError" }) as const,
    }).pipe(
      Effect.tap(({ data }) =>
        Effect.sync(() => {
          if (mounted) setAuthenticated(Boolean(data.user));
        }),
      ),
      Effect.ignore,
    );
    const fiber = Effect.runFork(lookup);
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session?.user));
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [demo]);

  async function sync() {
    setBusy(true);
    setMessage(null);
    const byId = new Map((workspace.reviewEvents ?? []).map((event) => [event.id, event]));
    let invalidIdentifier = false;
    const operations: SyncReviewOperation[] = pendingIds.flatMap((id) => {
      const event = byId.get(id);
      if (!event || !event.deviceId || !event.deviceSequence) return [];
      const decoded = Schema.decodeUnknownEither(SyncReviewOperationSchema)({
        id: event.id,
        cardId: event.cardId,
        deviceSequence: event.deviceSequence,
        baseReviewEventId: event.baseReviewEventId ?? null,
        reviewedAtDevice: event.reviewedAtDevice ?? event.ratedAt,
        effectiveReviewedAt: event.effectiveReviewedAt ?? event.ratedAt,
        rating: event.rating,
        elapsedMs: event.elapsedMs ?? null,
        schedulerFamily: event.schedulerFamily,
        schedulerVersion: event.schedulerVersion,
        schedulerParameterSetId: event.schedulerParameterSetId ?? null,
        previousStateHash: event.previousStateHash ?? null,
      });
      if (Either.isLeft(decoded)) {
        invalidIdentifier = true;
        return [];
      }
      return [decoded.right];
    });
    if (invalidIdentifier) {
      setBusy(false);
      setMessage(
        "Some pending reviews have invalid sync identifiers. Export a backup before continuing.",
      );
      return;
    }
    const desktop = window.recallDesktop;
    const client = desktop ? undefined : createSupabaseBrowserClient();
    const program = Effect.tryPromise({
      try: async () => {
        if (!desktop && !client) return { _tag: "SyncFailure" } as const;
        if (client) {
          const {
            data: { user },
          } = await client.auth.getUser();
          if (!user) return { _tag: "SyncFailure" } as const;
        }
        const remoteBeforePushResponse = await apiFetch("/api/v1/workspace");
        const remoteBeforePushPayload: unknown = await remoteBeforePushResponse.json();
        const remoteBeforePush =
          Schema.decodeUnknownEither(WorkspaceSnapshotSchema)(remoteBeforePushPayload);
        if (!remoteBeforePushResponse.ok || Either.isLeft(remoteBeforePush))
          return { _tag: "SyncFailure" } as const;
        const remoteById = new Map<string, (typeof remoteBeforePush.right.areas)[number]>(
          remoteBeforePush.right.areas.map((area) => [area.document.id, area]),
        );
        const localById = new Map(workspace.areas.map((area) => [area.id, area]));
        const deletedAreaIds = new Set([
          ...(workspace.deletedAreas ?? []).map((item) => item.areaId),
          ...remoteBeforePush.right.deletedAreaIds,
        ]);
        let invalidContentArea = false;
        const contentPushAreas = [
          ...remoteBeforePush.right.areas
            .filter((remoteArea) => !deletedAreaIds.has(remoteArea.document.id))
            .map((remoteArea) => {
              const localArea = localById.get(remoteArea.document.id);
              const baseContentHash = workspace.syncContentHashes?.[remoteArea.document.id];
              if (!localArea || !baseContentHash) {
                return { ...remoteArea, baseContentHash: remoteArea.contentHash };
              }
              const document = Effect.runSync(Effect.either(toKnowledgeArea(localArea, true)));
              if (Either.isLeft(document)) {
                invalidContentArea = true;
                return { ...remoteArea, baseContentHash: remoteArea.contentHash };
              }
              return {
                document: document.right,
                color: localArea.color,
                baseContentHash,
              };
            }),
          ...workspace.areas
            .filter((area) => !remoteById.has(area.id) && !deletedAreaIds.has(area.id))
            .map((area) => {
              const document = Effect.runSync(Effect.either(toKnowledgeArea(area, true)));
              if (Either.isLeft(document)) {
                invalidContentArea = true;
                return null;
              }
              return {
                document: document.right,
                color: area.color,
                baseContentHash: workspace.syncContentHashes?.[area.id] ?? null,
              };
            })
            .filter((area) => area !== null),
        ];
        if (invalidContentArea) return { _tag: "SyncFailure" } as const;
        const contentResponse = await apiFetch("/api/v1/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            areas: contentPushAreas,
            tombstones: workspace.deletedCards ?? [],
          }),
        });
        if (contentResponse.status === 409) {
          const areas: LearningArea[] = [];
          const hashes = Object.fromEntries(
            remoteBeforePush.right.areas.map((area) => [area.document.id, area.contentHash]),
          );
          for (const remoteArea of remoteBeforePush.right.areas) {
            const converted = Effect.runSync(
              Effect.either(
                fromKnowledgeArea(remoteArea.document, remoteArea.color, true, () =>
                  crypto.randomUUID(),
                ),
              ),
            );
            if (Either.isLeft(converted)) return { _tag: "SyncFailure" } as const;
            areas.push(converted.right);
          }
          setConflictData({
            areas,
            hashes,
            deletedAreaIds: remoteBeforePush.right.deletedAreaIds,
          });
          return { _tag: "ContentConflict" } as const;
        }
        if (!contentResponse.ok) return { _tag: "ContentSyncFailure" } as const;
        const response = await apiFetch("/api/v1/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schemaVersion: 1, deviceId: workspace.syncDeviceId, operations }),
        });
        const payload: unknown = await response.json();
        const decoded = Schema.decodeUnknownEither(SyncPushResponseSchema)(payload);
        if ((!response.ok && response.status !== 409) || Either.isLeft(decoded))
          return { _tag: "SyncFailure" } as const;
        let syncedAreaTombstoneIds: string[] = [];
        if (pendingAreaTombstones.length > 0 && decoded.right.conflicts.length === 0) {
          const tombstoneResponse = await apiFetch("/api/v1/workspace/area-tombstones", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ areaTombstones: pendingAreaTombstones }),
          });
          if (tombstoneResponse.status === 409) {
            const areas: LearningArea[] = [];
            const hashes = Object.fromEntries(
              remoteBeforePush.right.areas.map((area) => [area.document.id, area.contentHash]),
            );
            for (const remoteArea of remoteBeforePush.right.areas) {
              const converted = Effect.runSync(
                Effect.either(
                  fromKnowledgeArea(remoteArea.document, remoteArea.color, true, () =>
                    crypto.randomUUID(),
                  ),
                ),
              );
              if (Either.isLeft(converted)) return { _tag: "SyncFailure" } as const;
              areas.push(converted.right);
            }
            setConflictData({
              areas,
              hashes,
              deletedAreaIds: remoteBeforePush.right.deletedAreaIds,
            });
            return { _tag: "ContentConflict" } as const;
          }
          if (!tombstoneResponse.ok) return { _tag: "ContentSyncFailure" } as const;
          syncedAreaTombstoneIds = pendingAreaTombstones.map(({ areaId }) => areaId);
        }
        let cursor = workspace.syncCursor ?? "0";
        const pulledEvents: ReviewEvent[] = [];
        const deletedCardIds: string[] = [];
        const pulledDeletedAreaIds: string[] = [];
        let pages = 0;
        let pullComplete = false;
        while (pages < 100) {
          const pullResponse = await apiFetch(`/api/v1/sync?cursor=${encodeURIComponent(cursor)}`);
          const pullPayload: unknown = await pullResponse.json();
          const pull = Schema.decodeUnknownEither(SyncPullResponseSchema)(pullPayload);
          if (!pullResponse.ok || Either.isLeft(pull)) return { _tag: "SyncFailure" } as const;
          for (const change of pull.right.changes) {
            if (change.entityType === "card" && change.operation === "tombstone") {
              deletedCardIds.push(change.entityId);
              continue;
            }
            if (change.entityType === "area" && change.operation === "tombstone") {
              pulledDeletedAreaIds.push(change.entityId);
              continue;
            }
            if (change.entityType !== "review_event") continue;
            const event = Schema.decodeUnknownEither(ReviewEventSchema)(change.payload);
            if (Either.isLeft(event)) return { _tag: "SyncFailure" } as const;
            pulledEvents.push(event.right);
          }
          if (pull.right.cursor === cursor && pull.right.hasMore)
            return { _tag: "SyncFailure" } as const;
          cursor = pull.right.cursor;
          pages += 1;
          if (!pull.right.hasMore) {
            pullComplete = true;
            break;
          }
        }
        if (!pullComplete) return { _tag: "SyncFailure" } as const;
        const workspaceResponse = await apiFetch("/api/v1/workspace");
        const workspacePayload: unknown = await workspaceResponse.json();
        const remoteWorkspace =
          Schema.decodeUnknownEither(WorkspaceSnapshotSchema)(workspacePayload);
        if (!workspaceResponse.ok || Either.isLeft(remoteWorkspace))
          return { _tag: "SyncFailure" } as const;
        const pulledAreas: LearningArea[] = [];
        for (const areaId of remoteWorkspace.right.deletedAreaIds) {
          if (!pulledDeletedAreaIds.includes(areaId)) pulledDeletedAreaIds.push(areaId);
        }
        const contentHashes: Record<string, string> = {};
        for (const remoteArea of remoteWorkspace.right.areas) {
          const decodedArea = Effect.runSync(
            Effect.either(
              fromKnowledgeArea(remoteArea.document, remoteArea.color, true, () =>
                crypto.randomUUID(),
              ),
            ),
          );
          if (Either.isLeft(decodedArea)) return { _tag: "SyncFailure" } as const;
          pulledAreas.push(decodedArea.right);
          contentHashes[remoteArea.document.id] = remoteArea.contentHash;
        }
        return {
          _tag: "SyncSuccess",
          response: decoded.right,
          cursor,
          pulledEvents,
          pulledAreas,
          deletedCardIds,
          syncedAreaTombstoneIds,
          pulledDeletedAreaIds,
          contentHashes,
          conflicts: decoded.right.conflicts,
        } as const;
      },
      catch: () => ({ _tag: "WorkspaceSyncError" }) as const,
    }).pipe(
      Effect.match({
        onFailure: () => {
          setMessage("Sync failed. Your reviews are still saved on this device.");
        },
        onSuccess: (result) => {
          if (result._tag === "ContentSyncFailure") {
            setMessage(
              "Knowledge Areas could not sync. Your reviews are still saved on this device.",
            );
            return;
          }
          if (result._tag === "ContentConflict") {
            setMessage(
              "A Knowledge Area changed on another device. Review the server version before continuing.",
            );
            return;
          }
          if (result._tag === "SyncFailure") {
            setMessage("Sync failed. Your reviews are still saved on this device.");
            return;
          }
          const { acceptedIds, conflicts } = result.response;
          onSynced(
            acceptedIds,
            result.cursor,
            result.pulledEvents,
            result.pulledAreas,
            result.deletedCardIds,
            result.syncedAreaTombstoneIds,
            result.pulledDeletedAreaIds,
            result.contentHashes,
            result.conflicts,
          );
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

  if (demo || !enabled || !authenticated) return null;
  return (
    <div className="workspace-sync-action">
      <button className="text-button" type="button" onClick={() => void sync()} disabled={busy}>
        {busy ? "Syncing…" : `Sync${pendingIds.length ? ` · ${pendingIds.length}` : ""}`}
      </button>
      {message && (
        <span className="saved-state" role="status">
          {message}
        </span>
      )}
      {conflictData && (
        <button
          className="text-button"
          type="button"
          onClick={() => {
            onContentConflict(conflictData.areas, conflictData.hashes, conflictData.deletedAreaIds);
            setConflictData(null);
            setMessage("Server content loaded. Sync again to upload pending reviews.");
          }}
        >
          Use server version
        </button>
      )}
    </div>
  );
}
