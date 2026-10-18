import { readRef } from "@/lib/read-ref";
import { Effect, Either, Schema } from "effect";
import { emptyActivityLibrary, WorkspaceSchema } from "@recall/domain";
import {
  acceptPortableDeckImport,
  type ImportedPortableDeckPackage,
  saveWorkspaceWithMedia,
  mergeActivityLibraries,
  saveWorkspace,
} from "@recall/application";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { browserWorkspaceStore } from "@/features/workspace/browser-workspace-store";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { localSnapshotStale } from "@/features/workspace/local-snapshot-status";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import { importDashboardDelimitedFile } from "@/features/dashboard/transfers/RecallDashboardDelimitedImport";
import {
  dashboardColors as colors,
  type PendingContentImport,
} from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardCore } from "../../state/useRecallDashboardController";

const importFailureMessages = {
  paused:
    "Local changes are paused. The import is retained; recover storage or save the pending review before retrying.",
  unavailable: "The import has not been saved. Recover local storage, then retry the same import.",
  changedWorkspace:
    "Your workspace changed before the backup could be restored. Confirm replacement again to retry; the current workspace is unchanged.",
  changedArea:
    "The imported area already exists with newer changes. Cancel this import to keep those changes; no content was overwritten.",
  conflictingReview:
    "An imported review identity conflicts with existing history. No reviews were overwritten.",
  invalidContent:
    "The imported content exceeds workspace limits or has conflicting identities. No content was imported.",
  storage:
    "The import could not be confirmed saved. Its content is retained; retry before leaving this page.",
  writePaused:
    "The import could not be confirmed because local writes were paused. Its content is retained for retry.",
  fallback: "The import is paused. Save the pending review, then retry.",
} as const;

function hasConflictingReviewEvents(
  incoming: NonNullable<PendingContentImport["reviewEvents"]>,
  existing: ReadonlyMap<string, unknown>,
): boolean {
  return incoming.some((event) => {
    const prior = existing.get(event.id);
    return prior !== undefined && JSON.stringify(prior) !== JSON.stringify(event);
  });
}

function persistImportedWorkspace(
  candidate: RecallDashboardCore["workspace"],
  request: PendingContentImport,
) {
  const storageFailure = { message: importFailureMessages.storage };
  if (request.media)
    return saveWorkspaceWithMedia(
      browserWorkspaceStore,
      browserMediaStore,
      candidate,
      request.media,
    ).pipe(Effect.mapError(() => storageFailure));
  return saveWorkspace(browserWorkspaceStore, candidate).pipe(
    Effect.mapError(() => storageFailure),
  );
}

function importedContentCandidate(
  current: RecallDashboardCore["workspace"],
  request: PendingContentImport,
  hasExistingArea: boolean,
  newEvents: NonNullable<PendingContentImport["reviewEvents"]>,
): unknown {
  const incomingEvents = request.reviewEvents ?? [];
  return (
    request.replacement ?? {
      ...current,
      areas: hasExistingArea || !request.area ? current.areas : [...current.areas, request.area],
      ...(incomingEvents.length > 0
        ? {
            reviews: current.reviews + newEvents.length,
            reviewEvents: [...(current.reviewEvents ?? []), ...newEvents],
          }
        : {}),
    }
  );
}

export function createRecallDashboardContentActions(
  model: Pick<
    RecallDashboardCore,
    | "contentImportPending"
    | "pendingContentImport"
    | "setImportNotice"
    | "setContentImportBusy"
    | "cardEditorMounted"
    | "setPendingContentImport"
    | "enqueueWorkspaceCommit"
    | "pendingReviewRef"
    | "demo"
    | "ready"
    | "cacheWritable"
    | "workspaceRef"
    | "setWorkspace"
    | "setNow"
    | "setSelectedId"
    | "setShowAnswer"
    | "setActiveView"
    | "notesScope"
    | "enqueueWorkspaceSave"
    | "libraryNotes"
    | "workspace"
    | "requestConfirmation"
    | "setImportExportOpen"
  >,
) {
  const {
    contentImportPending,
    pendingContentImport,
    setImportNotice,
    setContentImportBusy,
    cardEditorMounted,
    setPendingContentImport,
    enqueueWorkspaceCommit,
    pendingReviewRef,
    demo,
    ready,
    cacheWritable,
    workspaceRef,
    setWorkspace,
    setNow,
    setSelectedId,
    setShowAnswer,
    setActiveView,
    notesScope,
    enqueueWorkspaceSave,
    libraryNotes,
    workspace,
    requestConfirmation,
    setImportExportOpen,
  } = model;
  function beginContentImport() {
    if (contentImportPending.current || pendingContentImport) {
      setImportNotice("Finish or cancel the current import before selecting another file.");
      return false;
    }
    contentImportPending.current = true;
    setContentImportBusy(true);
    return true;
  }
  function failContentImport(message: string) {
    contentImportPending.current = false;
    if (!cardEditorMounted.current) return;
    setContentImportBusy(false);
    setImportNotice(message);
  }
  async function commitContentImport(request: PendingContentImport) {
    if (!readRef(cardEditorMounted)) return false;
    contentImportPending.current = true;
    setContentImportBusy(true);
    setPendingContentImport(request);
    const saved = await Effect.runPromise(
      Effect.either(
        enqueueWorkspaceCommit(
          Effect.gen(function* () {
            for (;;) {
              if (
                !readRef(cardEditorMounted) ||
                localWritesBlocked() ||
                localSnapshotStale() ||
                readRef(pendingReviewRef)
              )
                return yield* Effect.fail({ message: importFailureMessages.paused });
              if (!demo && (!ready || !cacheWritable))
                return yield* Effect.fail({ message: importFailureMessages.unavailable });
              const current = workspaceRef.current;
              if (request.replacement && current !== request.expectedWorkspace)
                return yield* Effect.fail({ message: importFailureMessages.changedWorkspace });
              const existing =
                request.area && current.areas.find((item) => item.id === request.area?.id);
              if (existing && JSON.stringify(existing) !== JSON.stringify(request.area))
                return yield* Effect.fail({ message: importFailureMessages.changedArea });
              const incomingEvents = request.reviewEvents ?? [];
              const currentEvents = new Map(
                (current.reviewEvents ?? []).map((event) => [event.id, event]),
              );
              if (hasConflictingReviewEvents(incomingEvents, currentEvents))
                return yield* Effect.fail({ message: importFailureMessages.conflictingReview });
              const newEvents = incomingEvents.filter((event) => !currentEvents.has(event.id));
              const candidate = yield* Schema.decodeUnknown(WorkspaceSchema)(
                importedContentCandidate(current, request, Boolean(existing), newEvents),
              ).pipe(Effect.mapError(() => ({ message: importFailureMessages.invalidContent })));
              if (!demo) yield* persistImportedWorkspace(candidate, request);
              if (
                !readRef(cardEditorMounted) ||
                localWritesBlocked() ||
                localSnapshotStale() ||
                readRef(pendingReviewRef)
              )
                return yield* Effect.fail({ message: importFailureMessages.writePaused });
              if (workspaceRef.current !== current) continue;
              setWorkspace(candidate);
              return candidate;
            }
          }),
        ).pipe(
          Effect.mapError((error) =>
            "message" in error ? error.message : importFailureMessages.fallback,
          ),
        ),
      ),
    );
    contentImportPending.current = false;
    if (!readRef(cardEditorMounted)) return false;
    setContentImportBusy(false);
    if (Either.isRight(saved)) setNow(new Date());
    if (Either.isLeft(saved)) {
      setImportNotice(saved.left);
      return false;
    }
    setPendingContentImport(null);
    setSelectedId(request.area?.id ?? saved.right.areas[0]?.id ?? "");
    setShowAnswer(false);
    setActiveView(DashboardView.Today);
    setImportNotice(request.message);
    return true;
  }
  async function importPortableDeck(
    imported: ImportedPortableDeckPackage,
    restorePrivateHistory: boolean,
  ): Promise<boolean> {
    const expectedScope = notesScope;
    return enqueueWorkspaceSave(async () => {
      for (;;) {
        if (
          localWritesBlocked() ||
          localSnapshotStale() ||
          readRef(pendingReviewRef) ||
          (!demo && (!ready || !cacheWritable)) ||
          (workspaceRef.current.syncOwnerId ?? (demo ? "demo-library" : "local")) !== expectedScope
        )
          return false;
        const current = workspaceRef.current;
        const notes = libraryNotes.getCurrentNotes();
        if (!notes) return false;
        const result = Effect.runSync(
          Effect.either(
            Effect.gen(function* () {
              const activityLibrary = yield* mergeActivityLibraries(
                current.activityLibrary ?? emptyActivityLibrary,
                notes.activityLibrary ?? emptyActivityLibrary,
              );
              return yield* acceptPortableDeckImport({
                imported,
                workspace: { ...current, activityLibrary },
                color: colors[current.areas.length % colors.length] ?? "#c4ed68",
                createId: () => crypto.randomUUID(),
                now: new Date(),
                restorePrivateHistory,
              });
            }),
          ),
        );
        if (Either.isLeft(result)) {
          setImportNotice(
            "This package could not be added. Private history requires matching content and unused identities; try importing content only.",
          );
          return false;
        }
        if (!demo) {
          const saved = await Effect.runPromise(
            Effect.either(
              saveWorkspaceWithMedia(
                browserWorkspaceStore,
                browserMediaStore,
                result.right.workspace,
                result.right.media,
              ),
            ),
          );
          if (Either.isLeft(saved)) return false;
        }
        if (localWritesBlocked() || localSnapshotStale() || readRef(pendingReviewRef)) return false;
        if (workspaceRef.current !== current || libraryNotes.getCurrentNotes() !== notes) continue;
        setWorkspace(result.right.workspace);
        setSelectedId(result.right.area.id);
        setImportNotice(
          restorePrivateHistory
            ? "Private deck restored with its learning history."
            : "Deck copied with activities and attachments. Learning history starts fresh.",
        );
        return true;
      }
    });
  }
  function importDelimited(event: React.ChangeEvent<HTMLInputElement>) {
    importDashboardDelimitedFile(event, {
      areaCount: workspace.areas.length,
      colors,
      beginContentImport,
      failContentImport,
      clearContentImportBusy: () => {
        contentImportPending.current = false;
        setContentImportBusy(false);
      },
      requestConfirmation,
      setImportExportOpen,
      commitContentImport,
    });
  }
  return {
    beginContentImport,
    failContentImport,
    commitContentImport,
    importPortableDeck,
    importDelimited,
  } as const;
}
