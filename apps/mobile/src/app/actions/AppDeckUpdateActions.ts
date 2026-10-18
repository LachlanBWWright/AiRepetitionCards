import { emptyActivityLibrary } from "@recall/domain";
import { getActivityDefinitionSnapshot } from "../review/app-practice-recommendations";
import { Effect, Either } from "effect";
import * as Crypto from "expo-crypto";
import {
  toKnowledgeArea,
  mergeActivityLibraries,
  applyDeckWorkspaceUpdate,
  publicationContentHash,
} from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
import type { AppCoreState } from "../useAppController";
import type { createAppWorkspaceActions } from "./AppWorkspaceActions";
import type { Workspace } from "@recall/domain";
function retainDeckMedia(
  workspace: Workspace,
  expectedAreaId: string,
  assets: readonly StoredMediaAsset[],
) {
  const area = workspace.areas.find((item) => item.id === expectedAreaId);
  const required = new Set(
    area?.cards.flatMap((card) => card.media?.map((reference) => reference.id) ?? []) ?? [],
  );
  return assets.filter((asset) => required.has(asset.reference.id));
}
function applyUpdatedDeck(
  workspace: Workspace,
  activityLibrary: Workspace["activityLibrary"],
  area: import("@recall/domain").KnowledgeArea,
  currentFingerprint: string,
  versionId: string,
  advanceBaseline: boolean,
  now: Date,
  createId: () => string,
) {
  return applyDeckWorkspaceUpdate(
    {
      workspace: { ...workspace, activityLibrary },
      updatedArea: area,
      newVersionId: versionId,
      advanceBaseline,
      expectedCurrentAreaContentFingerprint: currentFingerprint,
    },
    now,
    createId,
  );
}
export function createAppDeckUpdateActions(
  model: Pick<
    AppCoreState & ReturnType<typeof createAppWorkspaceActions>,
    | "deckUpdateInProgressRef"
    | "activeArea"
    | "operationGeneration"
    | "accountUserId"
    | "libraryNotes"
    | "setDeckUpdateInProgress"
    | "store"
    | "cacheWritable"
    | "workspaceLifetime"
    | "activeAreaIdRef"
    | "authSession"
    | "commitWorkspaceChange"
    | "setActivityRestoreError"
  >,
) {
  const {
    deckUpdateInProgressRef,
    activeArea,
    operationGeneration,
    accountUserId,
    libraryNotes,
    setDeckUpdateInProgress,
    store,
    cacheWritable,
    workspaceLifetime,
    activeAreaIdRef,
    authSession,
    commitWorkspaceChange,
    setActivityRestoreError,
  } = model;
  function refreshActivityLibrary(
    current: Workspace,
    getNotes: () => ReturnType<typeof libraryNotes.getCurrentNotes>,
  ) {
    return Effect.gen(function* () {
      const latestNotes = getNotes();
      if (!latestNotes) return yield* Effect.fail({ _tag: "NativeDeckUpdateInvalid" } as const);
      const activityLibrary = yield* mergeActivityLibraries(
        current.activityLibrary ?? emptyActivityLibrary,
        latestNotes.activityLibrary ?? emptyActivityLibrary,
      ).pipe(Effect.mapError(() => ({ _tag: "NativeDeckUpdateInvalid" }) as const));
      return { ...current, activityLibrary };
    });
  }
  async function saveDeckUpdate(
    updatedArea: import("@recall/domain").KnowledgeArea,
    versionId: string,
    advanceBaseline: boolean,
    assets: readonly StoredMediaAsset[],
  ): Promise<boolean> {
    if (deckUpdateInProgressRef.current) return false;
    const expectedAreaId = activeArea?.id;
    const expectedPortable = activeArea
      ? Effect.runSync(Effect.either(toKnowledgeArea(activeArea, true, true)))
      : null;
    const expectedAreaSnapshot =
      expectedPortable && Either.isRight(expectedPortable)
        ? JSON.stringify(expectedPortable.right)
        : null;
    const expectedGeneration = operationGeneration;
    const expectedOwner = accountUserId;
    const invocationNotes = libraryNotes.getCurrentNotes();
    if (
      !expectedAreaId ||
      updatedArea.id !== expectedAreaId ||
      !expectedAreaSnapshot ||
      !invocationNotes
    )
      return false;
    const expectedActivityDefinitions = getActivityDefinitionSnapshot(
      invocationNotes,
      expectedAreaId,
    );
    deckUpdateInProgressRef.current = true;
    setDeckUpdateInProgress(true);
    try {
      const flushed = await libraryNotes.flush();
      const flushedNotes = libraryNotes.getCurrentNotes();
      if (
        !flushed ||
        !flushedNotes ||
        getActivityDefinitionSnapshot(flushedNotes, expectedAreaId) !== expectedActivityDefinitions
      )
        return false;
      return await persistDeckUpdate(
        updatedArea,
        versionId,
        advanceBaseline,
        assets,
        expectedAreaId,
        expectedAreaSnapshot,
        expectedGeneration,
        expectedOwner,
        expectedActivityDefinitions,
      );
    } finally {
      deckUpdateInProgressRef.current = false;
      setDeckUpdateInProgress(false);
    }
  }
  async function persistDeckUpdate(
    updatedArea: import("@recall/domain").KnowledgeArea,
    versionId: string,
    advanceBaseline: boolean,
    assets: readonly StoredMediaAsset[],
    expectedAreaId: string,
    expectedAreaSnapshot: string,
    expectedGeneration: number,
    expectedOwner: string | null,
    expectedActivityDefinitions: string,
  ): Promise<boolean> {
    if (!store || !cacheWritable) return false;
    const workspaceIsCurrent = () =>
      !workspaceLifetime.isBlocked() &&
      workspaceLifetime.generation() === expectedGeneration &&
      activeAreaIdRef.current === expectedAreaId &&
      authSession.current.userId === expectedOwner;
    const activityDefinitionsAreCurrent = () => {
      const latest = libraryNotes.getCurrentNotes();
      return (
        latest !== null &&
        getActivityDefinitionSnapshot(latest, expectedAreaId) === expectedActivityDefinitions
      );
    };
    const isCurrent = () => workspaceIsCurrent() && activityDefinitionsAreCurrent();
    if (!isCurrent()) return false;
    const result = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) =>
            Effect.gen(function* () {
              const currentArea = current.areas.find((item) => item.id === expectedAreaId);
              if (!currentArea)
                return yield* Effect.fail({ _tag: "NativeDeckUpdateStale" } as const);
              const latestNotes = libraryNotes.getCurrentNotes();
              if (!latestNotes)
                return yield* Effect.fail({ _tag: "NativeDeckUpdateInvalid" } as const);
              if (
                getActivityDefinitionSnapshot(latestNotes, expectedAreaId) !==
                expectedActivityDefinitions
              )
                return yield* Effect.fail({ _tag: "NativeDeckUpdateStale" } as const);
              const latestActivityLibrary = yield* mergeActivityLibraries(
                current.activityLibrary ?? emptyActivityLibrary,
                latestNotes.activityLibrary ?? emptyActivityLibrary,
              ).pipe(Effect.mapError(() => ({ _tag: "NativeDeckUpdateInvalid" }) as const));
              const currentDocument = yield* toKnowledgeArea(currentArea, true, true).pipe(
                Effect.mapError(() => ({ _tag: "NativeDeckUpdateInvalid" }) as const),
              );
              if (JSON.stringify(currentDocument) !== expectedAreaSnapshot)
                return yield* Effect.fail({ _tag: "NativeDeckUpdateStale" } as const);
              return yield* applyUpdatedDeck(
                current,
                latestActivityLibrary,
                updatedArea,
                publicationContentHash(currentDocument),
                versionId,
                advanceBaseline,
                new Date(),
                () => Crypto.randomUUID(),
              );
            }),
          expectedGeneration,
          {
            persistFirst: true,
            isCurrent,
            mediaForWorkspace: (next) => retainDeckMedia(next, expectedAreaId, assets),
          },
        ),
      ),
    );
    if (Either.isLeft(result) || !isCurrent()) {
      if (
        Either.isLeft(result) &&
        result.left._tag === "NativeWorkspaceUnavailable" &&
        workspaceIsCurrent() &&
        !activityDefinitionsAreCurrent()
      ) {
        await Effect.runPromise(
          Effect.either(
            commitWorkspaceChange(
              (current) => refreshActivityLibrary(current, () => libraryNotes.getCurrentNotes()),
              expectedGeneration,
              { persistFirst: true, isCurrent: workspaceIsCurrent },
            ),
          ),
        );
      }
      return false;
    }
    const savedLibrary = result.right.activityLibrary;
    if (savedLibrary) {
      libraryNotes.update((notes) => {
        const merged = Effect.runSync(
          Effect.either(
            mergeActivityLibraries(notes.activityLibrary ?? emptyActivityLibrary, savedLibrary),
          ),
        );
        if (Either.isLeft(merged)) {
          setActivityRestoreError(merged.left.message);
          return notes;
        }
        setActivityRestoreError(null);
        return { ...notes, activityLibrary: merged.right };
      });
    }
    return true;
  }
  return { saveDeckUpdate, persistDeckUpdate } as const;
}
