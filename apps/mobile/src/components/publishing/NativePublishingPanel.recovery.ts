import { Effect } from "effect";
import type { NativePublishingPanelActionsContext } from "./NativePublishingPanel.actions";

type RecoveryContext = Pick<
  NativePublishingPanelActionsContext,
  | "area"
  | "publication"
  | "forkOperationStore"
  | "publicationOperationStore"
  | "setNotice"
  | "setForkConflict"
  | "setPublicationConflict"
>;

export function createNativePublishingPanelRecoveryActions(context: RecoveryContext) {
  const {
    area,
    publication,
    forkOperationStore,
    publicationOperationStore,
    setNotice,
    setForkConflict,
    setPublicationConflict,
  } = context;

  function startNewForkAttempt(): void {
    if (!publication) return;
    Effect.runFork(
      forkOperationStore.clear(publication.versionId).pipe(
        Effect.match({
          onFailure: () => {
            setNotice(
              "The pending copy could not be cleared. Restore local storage before retrying.",
            );
          },
          onSuccess: () => {
            setForkConflict(false);
            setNotice(
              "The previous copy attempt was cleared. Add a personal copy to start a new operation.",
            );
          },
        }),
      ),
    );
  }

  function startNewPublicationAttempt(): void {
    if (!area) return;
    Effect.runFork(
      publicationOperationStore.clear(area.id).pipe(
        Effect.match({
          onFailure: () => {
            setNotice("Could not clear the pending attempt.");
          },
          onSuccess: () => {
            setPublicationConflict(false);
            setNotice("A new publication attempt is ready. The earlier attempt may already exist.");
          },
        }),
      ),
    );
  }

  return { startNewForkAttempt, startNewPublicationAttempt };
}
