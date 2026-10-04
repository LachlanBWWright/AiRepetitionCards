import { Effect } from "effect";
import { clearWorkspaceAndMedia } from "@recall/application";
import { uncoordinatedWorkspaceStore } from "./browser-workspace-store";
import { uncoordinatedMediaStore } from "./browser-media-store";
import { coordinateLocalErasure } from "./local-write-coordinator";

/** Drain active writes, reject queued writes, and clear all private device data. */
export const eraseLocalData = () =>
  coordinateLocalErasure(
    Effect.gen(function* () {
      const cleanup = yield* clearWorkspaceAndMedia(
        uncoordinatedWorkspaceStore,
        uncoordinatedMediaStore,
      );
      const sessionsCleared = yield* Effect.try({
        try: () => {
          for (const key of Object.keys(window.localStorage)) {
            if (
              [
                "recall-tutor-session:",
                "recall-chatgpt-tutor:",
                "recall-chatgpt-proposal-session:",
                "recall-chatgpt-welcome:",
                "recall-knowledge-notebook:",
                "recall-local-ai-usage",
                "recall-daily-reminders",
                "recall-pending-publication:",
                "recall-pending-fork:",
              ].some((prefix) => key.startsWith(prefix))
            )
              window.localStorage.removeItem(key);
          }
          window.dispatchEvent(new Event("recall-reminder-settings"));
          return true;
        },
        catch: () => ({ _tag: "LocalSessionCleanupFailure" }) as const,
      }).pipe(Effect.orElseSucceed(() => false));
      return cleanup.workspaceCleared && cleanup.mediaCleared && sessionsCleared;
    }),
  );
