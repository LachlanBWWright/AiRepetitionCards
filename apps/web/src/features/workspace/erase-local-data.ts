import { Effect } from "effect";
import { clearWorkspaceAndMedia } from "@recall/application";
import { uncoordinatedWorkspaceStore } from "./browser-workspace-store";
import { uncoordinatedMediaStore } from "./browser-media-store";
import { coordinateLocalErasure } from "./local-write-coordinator";
import { volatileStorage } from "@/lib/volatile-storage";

/** Drain active writes and clear the volatile web working copy. */
export const eraseLocalData = () =>
  coordinateLocalErasure(
    Effect.gen(function* () {
      const cleanup = yield* clearWorkspaceAndMedia(
        uncoordinatedWorkspaceStore,
        uncoordinatedMediaStore,
      );
      const keyedDataCleared = yield* Effect.try({
        try: () => {
          volatileStorage.clear();
          return true;
        },
        catch: () => ({ _tag: "LocalSessionCleanupFailure" }) as const,
      }).pipe(Effect.orElseSucceed(() => false));
      return cleanup.workspaceCleared && cleanup.mediaCleared && keyedDataCleared;
    }),
  );
