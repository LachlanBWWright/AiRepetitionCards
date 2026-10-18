import { emptyActivityLibrary } from "@recall/domain";
import { Alert } from "react-native";
import { Effect, Either } from "effect";
import * as Crypto from "expo-crypto";
import {
  bindWorkspaceOwner,
  workspaceHasRemoteSyncMetadata,
  mergeActivityLibraries,
  acceptPortableDeckImport,
  type ImportedPortableDeckPackage,
} from "@recall/application";
import {
  pickKnowledgeArea,
  pickWorkspaceBackup,
  shareKnowledgeArea,
  shareWorkspaceBackup,
} from "../../storage/interchange/native-interchange";
import { palette } from "../state/AppEnvironment";
import type { AppCoreState } from "../useAppController";
import type { createAppWorkspaceActions } from "./AppWorkspaceActions";
const importAreaColor = (areaCount: number) =>
  [palette.green, palette.coral, palette.violet, palette.amber][areaCount % 4] ?? palette.green;
export function createAppInterchangeActions(
  model: Pick<
    AppCoreState & ReturnType<typeof createAppWorkspaceActions>,
    | "workspaceLifetime"
    | "authSession"
    | "workspaceRef"
    | "mediaStore"
    | "commitWorkspaceChange"
    | "setCacheWritable"
    | "setActiveAreaId"
    | "setNow"
    | "workspace"
    | "activeAreaId"
    | "store"
    | "invalidateWorkspaceOperations"
    | "syncConflictGeneration"
    | "syncConflictAuthGeneration"
    | "setSyncConflictWorkspace"
    | "setMediaUris"
    | "setShowAnswer"
    | "setMessage"
    | "cacheWritable"
    | "authoringDisabledReason"
    | "libraryNotes"
  >,
) {
  const {
    workspaceLifetime,
    authSession,
    workspaceRef,
    mediaStore,
    commitWorkspaceChange,
    setCacheWritable,
    setActiveAreaId,
    setNow,
    workspace,
    activeAreaId,
    store,
    invalidateWorkspaceOperations,
    syncConflictGeneration,
    syncConflictAuthGeneration,
    setSyncConflictWorkspace,
    setMediaUris,
    setShowAnswer,
    setMessage,
    cacheWritable,
    authoringDisabledReason,
    libraryNotes,
  } = model;
  async function importKnowledgeArea(format?: "csv" | "tsv"): Promise<string> {
    const generation = workspaceLifetime.generation();
    const authGeneration = authSession.current.generation;
    const latest = workspaceRef.current;
    if (!latest) return "Your library is still loading.";
    if (!mediaStore) return "Local attachment storage is unavailable.";
    const areaColors = [palette.green, palette.coral, palette.violet, palette.amber];
    const color = areaColors[latest.areas.length % areaColors.length] ?? palette.green;
    const imported = await Effect.runPromise(
      Effect.either(pickKnowledgeArea(color, () => Crypto.randomUUID(), format)),
    );
    if (Either.isLeft(imported))
      return format
        ? "Import failed. Choose a valid CSV/TSV with question and answer columns, at most 500 cards and 200 objective labels. Large text files and malformed quoted fields are rejected."
        : "Import failed. Choose a valid Deck JSON or media ZIP file smaller than 25 MB.";
    const proposal = imported.right;
    if (!proposal) return "Import canceled.";
    {
      const accepted = await new Promise<boolean>((resolve) => {
        Alert.alert(
          format ? `Import ${format.toUpperCase()} cards?` : "Import deck package?",
          `${proposal.area.title}\n${String(proposal.area.cards.length)} cards · ${String(proposal.area.objectives?.length ?? 0)} objectives\n\nA separate deck will be added with fresh identities and schedules. Tags and objective labels are preserved. ${format ? "Attachments and review history are not imported." : "Packaged attachments are included; review history starts fresh."} Your existing library stays available.`,
          [
            {
              text: "Cancel",
              style: "cancel",
              onPress: () => {
                resolve(false);
              },
            },
            {
              text: "Import",
              onPress: () => {
                resolve(true);
              },
            },
          ],
          {
            cancelable: true,
            onDismiss: () => {
              resolve(false);
            },
          },
        );
      });
      if (!accepted) return "Import canceled.";
    }
    const saved = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) => Effect.succeed({ ...current, areas: [...current.areas, proposal.area] }),
          generation,
          {
            persistFirst: true,
            media: proposal.media,
            isCurrent: () => authSession.current.generation === authGeneration,
          },
        ),
      ),
    );
    if (Either.isLeft(saved)) {
      if (saved.left._tag === "NativeWorkspacePersistenceFailed") setCacheWritable(false);
      return saved.left._tag === "NativeWorkspaceUnavailable"
        ? "Import discarded because this workspace or account changed."
        : "The area was not imported because its workspace or attachments could not be saved.";
    }
    setActiveAreaId(proposal.area.id);
    setNow(Date.now());
    return `${proposal.area.title} imported. Its review history and schedule start fresh.`;
  }
  async function exportActiveArea(format?: "csv" | "tsv"): Promise<string> {
    const area = workspace?.areas.find((item) => item.id === activeAreaId) ?? workspace?.areas[0];
    if (!area) return "There is no deck to export.";
    if (!mediaStore) return "Local attachment storage is unavailable.";
    const result = await Effect.runPromise(
      Effect.either(shareKnowledgeArea(area, mediaStore, format)),
    );
    return Either.isRight(result)
      ? `${area.title} is ready to share.`
      : "The deck could not be exported.";
  }
  async function restorePrivateBackup(): Promise<string> {
    const generation = workspaceLifetime.generation();
    const authGeneration = authSession.current.generation;
    if (!store || !mediaStore) return "Local workspace or attachment storage is unavailable.";
    const selected = await Effect.runPromise(Effect.either(pickWorkspaceBackup()));
    if (Either.isLeft(selected)) return "The private backup is invalid or could not be read.";
    const backup = selected.right;
    if (!backup) return "Restore canceled.";
    const accepted = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Replace this workspace?",
        "The backup will replace decks, review history, schedules and local attachments. Its saved cloud account binding is retained.",
        [
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => {
              resolve(false);
            },
          },
          {
            text: "Restore backup",
            style: "destructive",
            onPress: () => {
              resolve(true);
            },
          },
        ],
        {
          cancelable: true,
          onDismiss: () => {
            resolve(false);
          },
        },
      );
    });
    if (!accepted) return "Restore canceled.";
    if (
      workspaceLifetime.generation() !== generation ||
      authSession.current.generation !== authGeneration ||
      workspaceLifetime.isBlocked()
    )
      return "Restore discarded because this workspace or account changed.";
    invalidateWorkspaceOperations();
    syncConflictGeneration.current = null;
    syncConflictAuthGeneration.current = null;
    setSyncConflictWorkspace(null);
    const restoreGeneration = workspaceLifetime.generation();
    const saved = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) => {
            const owner = backup.workspace.syncOwnerId;
            const activeOwner = authSession.current.userId;
            if (
              owner &&
              ((current.syncOwnerId && current.syncOwnerId !== owner) ||
                (activeOwner && activeOwner !== owner))
            )
              return Effect.fail({
                _tag: "WorkspaceSyncFailure",
                reason: "account-mismatch",
              } as const);
            if (!owner && current.syncOwnerId && workspaceHasRemoteSyncMetadata(backup.workspace))
              return Effect.fail({
                _tag: "WorkspaceSyncFailure",
                reason: "account-mismatch",
              } as const);
            return current.syncOwnerId && !owner
              ? bindWorkspaceOwner(backup.workspace, current.syncOwnerId)
              : Effect.succeed(backup.workspace);
          },
          restoreGeneration,
          {
            persistFirst: true,
            restoreWrite: true,
            media: backup.media,
            isCurrent: () => authSession.current.generation === authGeneration,
          },
        ),
      ),
    );
    if (Either.isLeft(saved)) {
      if (saved.left._tag === "WorkspaceSyncFailure")
        return "This backup has a different or unconfirmed cloud owner. Keep the current workspace, export it, then sign in to the backup owner or reset to restore it offline.";
      return "The workspace could not be replaced. The previous workspace remains available.";
    }
    setActiveAreaId(saved.right.areas[0]?.id ?? null);
    setMediaUris({});
    setShowAnswer(false);
    setCacheWritable(true);
    setMessage(null);
    return "Private backup restored, including its account binding, reviews, schedules and attachments.";
  }
  async function importPortableDeck(
    imported: ImportedPortableDeckPackage,
    restorePrivateHistory: boolean,
  ): Promise<boolean> {
    if (!store || !mediaStore || !cacheWritable || authoringDisabledReason !== undefined)
      return false;
    const expectedGeneration = workspaceLifetime.generation();
    const expectedAuthGeneration = authSession.current.generation;
    const isCurrent = () =>
      !workspaceLifetime.isBlocked() &&
      workspaceLifetime.generation() === expectedGeneration &&
      authSession.current.generation === expectedAuthGeneration;
    const saved = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) =>
            Effect.gen(function* () {
              const notes = libraryNotes.getCurrentNotes();
              if (!notes)
                return yield* Effect.fail({ _tag: "NativePortableImportUnavailable" } as const);
              const activityLibrary = yield* mergeActivityLibraries(
                current.activityLibrary ?? emptyActivityLibrary,
                notes.activityLibrary ?? emptyActivityLibrary,
              );
              const accepted = yield* acceptPortableDeckImport({
                imported,
                workspace: { ...current, activityLibrary },
                color: importAreaColor(current.areas.length),
                createId: Crypto.randomUUID,
                now: new Date(),
                restorePrivateHistory,
              });
              return accepted.workspace;
            }),
          expectedGeneration,
          { persistFirst: true, isCurrent, media: imported.media },
        ),
      ),
    );
    if (Either.isLeft(saved) || !isCurrent()) return false;
    setActiveAreaId(saved.right.areas.at(-1)?.id ?? null);
    setMediaUris({});
    setShowAnswer(false);
    return true;
  }
  async function exportPrivateBackup(): Promise<string> {
    if (!workspace || !mediaStore) return "Workspace or attachment storage is unavailable.";
    if (!libraryNotes.loaded)
      return "Wait for learning activities to load before exporting a complete backup.";
    const merged = Effect.runSync(
      Effect.either(
        mergeActivityLibraries(
          workspace.activityLibrary ?? emptyActivityLibrary,
          libraryNotes.notes.activityLibrary ?? emptyActivityLibrary,
        ),
      ),
    );
    if (Either.isLeft(merged)) return merged.left.message;
    const result = await Effect.runPromise(
      Effect.either(
        shareWorkspaceBackup(
          {
            ...workspace,
            activityLibrary: merged.right,
          },
          mediaStore,
        ),
      ),
    );
    return Either.isRight(result)
      ? "Private workspace backup is ready to share."
      : "The private workspace backup could not be exported.";
  }
  return {
    importKnowledgeArea,
    exportActiveArea,
    restorePrivateBackup,
    importPortableDeck,
    exportPrivateBackup,
  } as const;
}
