import { readRef } from "@/lib/read-ref";
import { Effect, Either } from "effect";
import { emptyActivityLibrary } from "@recall/domain";
import {
  applyDeckWorkspaceUpdate,
  retainPublishedActivityDefinitions,
  publicationContentHash,
  saveWorkspaceWithMedia,
  mergeActivityLibraries,
} from "@recall/application";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { fromKnowledgeArea, toKnowledgeArea } from "@/features/workspace/knowledge-area-json";
import { browserWorkspaceStore } from "@/features/workspace/browser-workspace-store";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { localSnapshotStale } from "@/features/workspace/local-snapshot-status";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import { dashboardColors as colors } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { ComponentProps } from "react";
import type { KnowledgeAreaPublishing } from "@/components/publishing/releases/KnowledgeAreaPublishing";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
import type { Workspace } from "@/features/workspace/types";

async function rollbackPublishedWorkspace(workspace: Workspace): Promise<boolean> {
  const saved = await Effect.runPromise(
    Effect.either(saveWorkspaceWithMedia(browserWorkspaceStore, browserMediaStore, workspace, [])),
  );
  return Either.isRight(saved);
}

async function savePublishedWorkspace(
  workspace: Workspace,
  assets: Parameters<NonNullable<ComponentProps<typeof KnowledgeAreaPublishing>["onUpdate"]>>[3],
): Promise<boolean> {
  const saved = await Effect.runPromise(
    Effect.either(
      saveWorkspaceWithMedia(browserWorkspaceStore, browserMediaStore, workspace, assets),
    ),
  );
  return Either.isRight(saved);
}

async function saveExistingFork(
  workspace: Workspace,
  existing: Workspace["areas"][number],
  assets: Parameters<NonNullable<ComponentProps<typeof KnowledgeAreaPublishing>["onFork"]>>[5],
): Promise<boolean> {
  const requiredMedia = new Set(
    existing.cards.flatMap((card) => (card.media ?? []).map((reference) => reference.id)),
  );
  const saved = await Effect.runPromise(
    Effect.either(
      saveWorkspaceWithMedia(
        browserWorkspaceStore,
        browserMediaStore,
        workspace,
        assets.filter((asset) => requiredMedia.has(asset.reference.id)),
      ),
    ),
  );
  return Either.isRight(saved);
}

function applyPublishedAreaUpdate(
  workspace: Workspace,
  updatedArea: Parameters<
    NonNullable<ComponentProps<typeof KnowledgeAreaPublishing>["onUpdate"]>
  >[0],
  versionId: string,
  advanceBaseline: boolean,
  expected: string,
) {
  return Effect.runSync(
    Effect.either(
      applyDeckWorkspaceUpdate(
        {
          workspace,
          updatedArea,
          newVersionId: versionId,
          advanceBaseline,
          expectedCurrentAreaContentFingerprint: expected,
        },
        new Date(),
        () => crypto.randomUUID(),
      ),
    ),
  );
}

function retainImportedForkActivities(
  current: Workspace,
  importedArea: Workspace["areas"][number],
  contentHash: string,
  document: Parameters<typeof retainPublishedActivityDefinitions>[1],
) {
  const workspace = {
    ...current,
    areas: [...current.areas, importedArea],
    syncContentHashes: {
      ...(current.syncContentHashes ?? {}),
      [importedArea.id]: contentHash,
    },
  };
  return Effect.runSync(Effect.either(retainPublishedActivityDefinitions(workspace, document)));
}

export function createRecallDashboardPublicationActions(
  model: Pick<
    RecallDashboardModel,
    | "deckUpdatePendingRef"
    | "setDeckUpdatePending"
    | "publishingAreaDocument"
    | "area"
    | "enqueueWorkspaceSave"
    | "pendingReviewRef"
    | "demo"
    | "ready"
    | "cacheWritable"
    | "libraryNotes"
    | "workspaceRef"
    | "setImportNotice"
    | "setWorkspace"
    | "setSelectedId"
    | "setActiveView"
  >,
) {
  const {
    deckUpdatePendingRef,
    setDeckUpdatePending,
    publishingAreaDocument,
    area,
    enqueueWorkspaceSave,
    pendingReviewRef,
    demo,
    ready,
    cacheWritable,
    libraryNotes,
    workspaceRef,
    setImportNotice,
    setWorkspace,
    setSelectedId,
    setActiveView,
  } = model;
  const onUpdate: NonNullable<ComponentProps<typeof KnowledgeAreaPublishing>["onUpdate"]> = async (
    updatedArea,
    versionId,
    advanceBaseline,
    assets,
  ) => {
    if (deckUpdatePendingRef.current) return false;
    deckUpdatePendingRef.current = true;
    setDeckUpdatePending(true);
    try {
      if (!publishingAreaDocument || Either.isLeft(publishingAreaDocument)) return false;
      const cardDocument = area
        ? Effect.runSync(Effect.either(toKnowledgeArea(area, true, true)))
        : null;
      if (!cardDocument || Either.isLeft(cardDocument)) return false;
      const expected = publicationContentHash(cardDocument.right);
      return await enqueueWorkspaceSave(async () => {
        for (;;) {
          if (
            localWritesBlocked() ||
            localSnapshotStale() ||
            readRef(pendingReviewRef) ||
            (!demo && (!ready || !cacheWritable))
          )
            return false;
          if (!(await libraryNotes.flush())) return false;
          const notes = libraryNotes.getCurrentNotes();
          if (!notes) return false;
          const current = workspaceRef.current;
          const existingLibrary = Effect.runSync(
            Effect.either(
              mergeActivityLibraries(
                notes.activityLibrary ?? emptyActivityLibrary,
                current.activityLibrary ?? emptyActivityLibrary,
              ),
            ),
          );
          if (Either.isLeft(existingLibrary)) {
            setImportNotice(
              "Your saved activities changed in another workspace. Retry after resolving the activity conflict.",
            );
            return false;
          }
          const currentAreaDefinitions =
            notes.activityLibrary?.activities.filter(
              (activity) => activity.areaId === updatedArea.id && !activity.archived,
            ) ?? [];
          const reviewedAreaDefinitions = publishingAreaDocument.right.activities.filter(
            (activity) => activity.areaId === updatedArea.id && !activity.archived,
          );
          const definitionSignature = (activities: readonly { readonly id: string }[]) =>
            JSON.stringify(
              [...activities].sort((left, right) => left.id.localeCompare(right.id, "en")),
            );
          if (
            definitionSignature(currentAreaDefinitions) !==
            definitionSignature(reviewedAreaDefinitions)
          ) {
            setImportNotice(
              "Activities in this area changed after you reviewed the update. Review the deck again before applying it.",
            );
            return false;
          }
          const workspaceWithLibrary = {
            ...current,
            activityLibrary: existingLibrary.right,
          };
          const result = applyPublishedAreaUpdate(
            workspaceWithLibrary,
            updatedArea,
            versionId,
            advanceBaseline,
            expected,
          );
          if (Either.isLeft(result)) {
            setImportNotice(
              "Your deck changed or the update could not be applied. Review it before retrying.",
            );
            return false;
          }
          if (!demo) {
            if (!(await savePublishedWorkspace(result.right, assets))) return false;
          }
          if (localWritesBlocked() || localSnapshotStale() || readRef(pendingReviewRef))
            return false;
          const latestNotes = libraryNotes.getCurrentNotes();
          const workspaceChanged = workspaceRef.current !== current;
          const definitionsChanged = latestNotes?.activityLibrary !== notes.activityLibrary;
          if (workspaceChanged || definitionsChanged) {
            if (
              !demo &&
              !(await rollbackPublishedWorkspace(workspaceChanged ? workspaceRef.current : current))
            )
              return false;
            if (workspaceChanged) continue;
            const latestAreaDefinitions =
              latestNotes?.activityLibrary?.activities.filter(
                (activity) => activity.areaId === updatedArea.id && !activity.archived,
              ) ?? [];
            if (
              definitionSignature(latestAreaDefinitions) !==
              definitionSignature(reviewedAreaDefinitions)
            ) {
              setImportNotice(
                "Activities in this area changed after you reviewed the update. Review the deck again before applying it.",
              );
              return false;
            }
            continue;
          }
          setWorkspace(result.right);
          setImportNotice("Selected deck changes saved. Review history is preserved.");
          return true;
        }
      });
    } finally {
      deckUpdatePendingRef.current = false;
      setDeckUpdatePending(false);
    }
  };
  const onFork: NonNullable<ComponentProps<typeof KnowledgeAreaPublishing>["onFork"]> = async (
    document,
    attribution,
    license,
    forkedFromVersionId,
    contentHash,
    assets,
  ) => {
    if ((!cacheWritable || !ready || localWritesBlocked()) && !demo) return false;
    return enqueueWorkspaceSave(async () => {
      for (;;) {
        if (localWritesBlocked() || localSnapshotStale() || readRef(pendingReviewRef)) return false;
        const current = workspaceRef.current;
        const existing = current.areas.find((item) => item.id === document.id);
        if (existing) {
          if (existing.forkedFromVersionId !== forkedFromVersionId) return false;
          const retained = Effect.runSync(
            Effect.either(retainPublishedActivityDefinitions(current, document)),
          );
          if (Either.isLeft(retained)) return false;
          if (!demo) {
            if (!(await saveExistingFork(retained.right, existing, assets))) {
              setImportNotice(
                "Your cloud copy is saved, but local storage failed. Retry to receive the same copy.",
              );
              return false;
            }
          }
          if (localWritesBlocked() || localSnapshotStale() || readRef(pendingReviewRef))
            return false;
          if (workspaceRef.current !== current) continue;
          setWorkspace(retained.right);
          setSelectedId(existing.id);
          setActiveView(DashboardView.Today);
          return true;
        }
        const imported = Effect.runSync(
          Effect.either(
            fromKnowledgeArea(
              {
                ...document,
                licence: license,
                attribution,
                forkedFromVersionId,
              },
              colors[current.areas.length % colors.length] ?? "#c4ed68",
              true,
              () => crypto.randomUUID(),
              new Date(),
              true,
            ),
          ),
        );
        if (Either.isLeft(imported)) return false;
        const retained = retainImportedForkActivities(
          current,
          imported.right,
          contentHash,
          document,
        );
        if (Either.isLeft(retained)) return false;
        const next = retained.right;
        if (!demo) {
          const saved = await Effect.runPromise(
            Effect.either(
              saveWorkspaceWithMedia(browserWorkspaceStore, browserMediaStore, next, assets),
            ),
          );
          if (Either.isLeft(saved)) {
            setImportNotice(
              "Your cloud copy is saved, but local storage failed. Retry to receive the same copy.",
            );
            return false;
          }
        }
        if (localWritesBlocked() || localSnapshotStale() || readRef(pendingReviewRef)) return false;
        if (workspaceRef.current !== current) continue;
        setWorkspace(next);
        setSelectedId(imported.right.id);
        setActiveView(DashboardView.Today);
        setImportNotice(
          `${imported.right.title} added as your copy. Attribution and license are preserved.`,
        );
        return true;
      }
    });
  };
  return { onUpdate, onFork } as const;
}
