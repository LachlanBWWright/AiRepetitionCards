export {
  clearWorkspace,
  clearWorkspaceAndMedia,
  loadWorkspace,
  saveWorkspace,
  saveWorkspaceWithMedia,
} from "./workspace-persistence";

export type {
  WorkspaceMediaClearResult,
  WorkspaceMediaCommitFailure,
} from "./workspace-persistence";

export { persistMediaAssets } from "./media/media-persistence";

export type { MediaPersistenceFailure } from "./media/media-persistence";

export { createWorkspaceMediaGateway, syncWorkspaceMedia } from "./media/workspace-media-sync";

export type {
  WorkspaceMediaGateway,
  WorkspaceMediaGatewayFailure,
  WorkspaceMediaHttpRequest,
  WorkspaceMediaHttpResponse,
  WorkspaceMediaSyncFailure,
  WorkspaceMediaTransport,
  WorkspaceMediaTransportFailure,
} from "./media/workspace-media-sync";

export {
  syncWorkspace,
  applyWorkspaceSyncChanges,
  applyWorkspaceContentConflict,
} from "./sync/workspace-sync";

export type {
  WorkspaceContentConflict,
  WorkspaceSyncInput,
  WorkspaceSyncResult,
  WorkspaceSyncChanges,
  WorkspaceSyncFailure,
  WorkspaceSyncCheckpointFailure,
  WorkspaceSyncRequest,
  WorkspaceSyncResponse,
  WorkspaceSyncTransport,
  WorkspaceSyncTransportFailure,
} from "./sync/workspace-sync";

export { searchWorkspace } from "./workspace-search";

export type {
  WorkspaceSearchTarget,
  WorkspaceSearchKind,
  WorkspaceSearchNotebook,
  WorkspaceSearchNotebookLoadResult,
  WorkspaceSearchResult,
  WorkspaceSearchOptions,
} from "./workspace-search";

export {
  inspectCollection,
  collectionCardIssues,
  maintainCollectionMedia,
  type CollectionHealth,
} from "./maintenance/collection-health";
export { workspaceMediaReferences, areaMediaReferences } from "./media/media-references";

export {
  restoreWorkspaceCheckpoint,
  repairCollectionReferences,
} from "./maintenance/workspace-recovery";

export {
  purgeMediaTrash,
  applyMediaTrashPurge,
  type MediaTrashPurgeResult,
} from "./maintenance/purge-media-trash";
