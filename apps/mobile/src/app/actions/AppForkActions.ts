import { Effect, Either } from "effect";
import * as Crypto from "expo-crypto";
import { fromKnowledgeArea, retainPublishedActivityDefinitions } from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
import type { Workspace } from "@recall/domain";
import { palette } from "../state/AppEnvironment";
import type { AppCoreState } from "../useAppController";
import type { createAppWorkspaceActions } from "./AppWorkspaceActions";
function retainedForkAssets(
  workspace: Workspace,
  areaId: string,
  assets: readonly StoredMediaAsset[],
) {
  const area = workspace.areas.find((item) => item.id === areaId);
  const requiredIds = new Set(
    area?.cards.flatMap((card) => card.media?.map((item) => item.id) ?? []) ?? [],
  );
  return assets.filter((asset) => requiredIds.has(asset.reference.id));
}
function withForkContentHash(
  workspace: Workspace,
  imported: Workspace["areas"][number],
  contentHash: string,
): Workspace {
  return {
    ...workspace,
    areas: [...workspace.areas, imported],
    syncContentHashes: { ...(workspace.syncContentHashes ?? {}), [imported.id]: contentHash },
  };
}
const forkConflict = () => Effect.fail({ _tag: "NativeForkConflict" } as const);
const forkAreaColor = (areaCount: number) =>
  [palette.green, palette.coral, palette.violet, palette.amber][areaCount % 4] ?? palette.green;
function resolveExistingFork(
  workspace: Workspace,
  existing: Workspace["areas"][number],
  versionId: string,
  document: import("@recall/domain").KnowledgeArea,
) {
  return existing.forkedFromVersionId === versionId
    ? retainPublishedActivityDefinitions(workspace, document)
    : forkConflict();
}
export function createAppForkActions(
  model: Pick<
    AppCoreState & ReturnType<typeof createAppWorkspaceActions>,
    | "store"
    | "cacheWritable"
    | "commitWorkspaceChange"
    | "operationGeneration"
    | "setMessage"
    | "setActiveAreaId"
    | "setShowAnswer"
  >,
) {
  const {
    store,
    cacheWritable,
    commitWorkspaceChange,
    operationGeneration,
    setMessage,
    setActiveAreaId,
    setShowAnswer,
  } = model;
  async function addPublishedFork(
    document: import("@recall/domain").KnowledgeArea,
    attribution: string | null,
    license: string | null,
    forkedFromVersionId: string,
    contentHash: string,
    assets: readonly StoredMediaAsset[],
  ): Promise<boolean> {
    if (!store || !cacheWritable) return false;
    const committed = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) =>
            Effect.gen(function* () {
              const existing = current.areas.find((item) => item.id === document.id);
              if (existing)
                return yield* resolveExistingFork(current, existing, forkedFromVersionId, document);
              const imported = yield* fromKnowledgeArea(
                { ...document, attribution, licence: license, forkedFromVersionId },
                forkAreaColor(current.areas.length),
                true,
                () => Crypto.randomUUID(),
                new Date(),
                true,
              );
              return yield* retainPublishedActivityDefinitions(
                withForkContentHash(current, imported, contentHash),
                document,
              );
            }),
          operationGeneration,
          {
            persistFirst: true,
            mediaForWorkspace: (next) => retainedForkAssets(next, document.id, assets),
          },
        ),
      ),
    );
    if (Either.isLeft(committed)) {
      setMessage(
        "Your cloud copy is saved, but local storage failed. Retry to receive the same copy.",
      );
      return false;
    }
    setActiveAreaId(document.id);
    setShowAnswer(false);
    return true;
  }
  return { addPublishedFork } as const;
}
