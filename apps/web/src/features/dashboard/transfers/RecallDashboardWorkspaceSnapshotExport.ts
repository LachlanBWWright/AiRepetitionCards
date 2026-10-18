import { Effect, Either } from "effect";
import { mergeActivityLibraries } from "@recall/application";
import { emptyActivityLibrary } from "@recall/domain";
import type { PendingReview } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { Workspace } from "@/features/workspace/types";

export function exportDashboardWorkspaceSnapshot(dependencies: {
  readonly workspace: Workspace;
  readonly activityLibrary: Workspace["activityLibrary"];
  readonly pendingReview: PendingReview | null;
  readonly downloadText: (name: string, content: string, contentType: string) => void;
  readonly onSuccess: (message: string) => void;
  readonly onFailure: (message: string) => void;
}): void {
  const merged = Effect.runSync(
    Effect.either(
      mergeActivityLibraries(
        dependencies.workspace.activityLibrary ?? emptyActivityLibrary,
        dependencies.activityLibrary ?? emptyActivityLibrary,
      ),
    ),
  );
  if (Either.isLeft(merged)) {
    dependencies.onFailure(merged.left.message);
    return;
  }
  const exported = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => {
          dependencies.downloadText(
            "recall-unsaved-workspace.json",
            JSON.stringify(
              {
                backupVersion: 1,
                exportedAt: new Date().toISOString(),
                workspace: { ...dependencies.workspace, activityLibrary: merged.right },
                unconfirmedReviewAttempt: dependencies.pendingReview,
              },
              null,
              2,
            ),
            "application/json",
          );
        },
        catch: () => ({ _tag: "WorkspaceSnapshotDownloadFailure" }) as const,
      }),
    ),
  );
  if (Either.isLeft(exported))
    dependencies.onFailure(
      "This tab's snapshot could not be downloaded. Try exporting again before reloading.",
    );
  else
    dependencies.onSuccess(
      "This tab's private JSON snapshot was exported with reviews and schedules. Attachment bytes are included only in ZIP backups.",
    );
}
