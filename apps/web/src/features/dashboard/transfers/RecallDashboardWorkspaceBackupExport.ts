import { emptyActivityLibrary } from "@recall/domain";
import { Effect, Either } from "effect";
import { exportWorkspaceBackupPackage, mergeActivityLibraries } from "@recall/application";
import type { Workspace } from "@/features/workspace/types";
import { browserMediaStore } from "@/features/workspace/browser-media-store";

export async function exportDashboardWorkspaceBackup(dependencies: {
  readonly workspace: Workspace;
  readonly activityLibrary: Workspace["activityLibrary"];
  readonly notesLoaded: boolean;
  readonly mediaStore: typeof browserMediaStore;
  readonly setImportNotice: (message: string) => void;
  readonly onSuccess: (message: string) => void;
  readonly onCancel: (message: string) => void;
  readonly onFailure: (message: string) => void;
}): Promise<void> {
  if (!dependencies.notesLoaded) {
    dependencies.setImportNotice(
      "Wait for learning activities to load before exporting a complete backup.",
    );
    return;
  }
  const merged = Effect.runSync(
    Effect.either(
      mergeActivityLibraries(
        dependencies.workspace.activityLibrary ?? emptyActivityLibrary,
        dependencies.activityLibrary ?? emptyActivityLibrary,
      ),
    ),
  );
  if (Either.isLeft(merged)) {
    dependencies.setImportNotice(merged.left.message);
    return;
  }
  const result = await Effect.runPromise(
    Effect.either(
      exportWorkspaceBackupPackage(
        { ...dependencies.workspace, activityLibrary: merged.right },
        new Date().toISOString(),
        dependencies.mediaStore,
      ),
    ),
  );
  if (Either.isLeft(result)) {
    dependencies.setImportNotice(
      "The private backup could not be created. Check that all attachments are saved.",
    );
    return;
  }
  const buffer = new ArrayBuffer(result.right.byteLength);
  new Uint8Array(buffer).set(result.right);
  const desktop = window.recallDesktop;
  if (desktop) {
    const saved = await desktop.backup.save(result.right);
    if (
      typeof saved === "object" &&
      saved !== null &&
      "_tag" in saved &&
      saved._tag === "Success" &&
      "value" in saved &&
      saved.value === true
    ) {
      dependencies.onSuccess(
        "Private backup exported with review history, schedules, and attached media.",
      );
    } else if (
      typeof saved === "object" &&
      saved !== null &&
      "_tag" in saved &&
      saved._tag === "Success" &&
      "value" in saved &&
      saved.value === false
    ) {
      dependencies.onCancel("Backup export was canceled.");
    } else {
      dependencies.onFailure("The private backup could not be saved.");
    }
    return;
  }
  const objectUrl = URL.createObjectURL(new Blob([buffer], { type: "application/zip" }));
  const link = window.document.createElement("a");
  link.href = objectUrl;
  link.download = "recall-workspace-backup.zip";
  link.click();
  URL.revokeObjectURL(objectUrl);
  dependencies.onSuccess(
    "Private backup exported with review history, schedules, and attached media.",
  );
}
