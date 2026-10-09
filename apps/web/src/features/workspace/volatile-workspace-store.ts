import { Effect } from "effect";
import type { WorkspaceStore } from "@recall/local-store";

// The web client keeps an unsaved working copy only for the lifetime of this tab.
// Account data is persisted by the authenticated sync API, never by browser storage.
let snapshot: string | null = null;

export const volatileWorkspaceStore: WorkspaceStore = {
  read: Effect.sync(() => snapshot),
  write: (serializedWorkspace) =>
    Effect.sync(() => {
      snapshot = serializedWorkspace;
    }),
  clear: Effect.sync(() => {
    snapshot = null;
  }),
};
