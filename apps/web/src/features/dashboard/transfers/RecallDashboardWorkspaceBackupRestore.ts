import { Effect, Either, Schema } from "effect";
import { importWorkspaceBackupPackage } from "@recall/application";
import { parseWorkspaceJson } from "@recall/domain";
import type { PendingContentImport } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { Workspace } from "@/features/workspace/types";
import { prepareWorkspaceForSync } from "@/features/workspace/sync-outbox";

export async function restoreDashboardWorkspaceBackupFile(
  file: File,
  dependencies: {
    readonly isEditorMounted: () => boolean;
    readonly beginContentImport: () => boolean;
    readonly failContentImport: (message: string) => void;
    readonly setImportNotice: (message: string) => void;
    readonly requestConfirmation: (
      description: string,
      onConfirm: () => unknown,
      onCancel?: () => void,
    ) => void;
    readonly commitContentImport: (request: PendingContentImport) => Promise<boolean>;
    readonly currentWorkspace: () => Workspace;
  },
): Promise<void> {
  if (file.size > 100_000_000) {
    dependencies.setImportNotice("Workspace backup packages must be 100 MB or smaller.");
    return;
  }
  if (file.name.toLowerCase().endsWith(".zip")) {
    if (!dependencies.beginContentImport()) return;
    const imported = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: () => ({ _tag: "WorkspaceBackupReadFailure" }) as const,
        }).pipe(Effect.flatMap((buffer) => importWorkspaceBackupPackage(new Uint8Array(buffer)))),
      ),
    );
    if (Either.isLeft(imported)) {
      dependencies.failContentImport(
        "That private backup is invalid, too large, or has missing media.",
      );
      return;
    }
    if (!dependencies.isEditorMounted()) return;
    const prepared = prepareWorkspaceForSync(imported.right.workspace, () => crypto.randomUUID());
    dependencies.requestConfirmation(
      "Replace this tab’s current workspace with the selected backup?",
      () =>
        dependencies.commitContentImport({
          replacement: prepared,
          expectedWorkspace: dependencies.currentWorkspace(),
          media: imported.right.media,
          message: "Private backup restored with review history, schedules, and media.",
        }),
      () => {
        dependencies.failContentImport("Backup restore cancelled. Your workspace is unchanged.");
      },
    );
    return;
  }
  if (file.size > 10_000_000) {
    dependencies.setImportNotice("Legacy JSON workspace backups must be 10 MB or smaller.");
    return;
  }
  const fileText = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: () => file.text(),
        catch: () => ({ _tag: "WorkspaceBackupReadError" }) as const,
      }),
    ),
  );
  if (Either.isLeft(fileText)) {
    dependencies.setImportNotice("The workspace backup could not be read.");
    return;
  }
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => JSON.parse(fileText.right) as unknown,
        catch: () => ({ _tag: "WorkspaceBackupParseError" }) as const,
      }),
    ),
  );
  if (Either.isLeft(parsed)) {
    dependencies.setImportNotice("That file is not a valid Recall workspace backup.");
    return;
  }
  const backup = Schema.decodeUnknownEither(
    Schema.Struct({
      backupVersion: Schema.Literal(1),
      exportedAt: Schema.String,
      workspace: Schema.Unknown,
    }),
  )(parsed.right);
  if (
    Either.isLeft(backup) ||
    typeof backup.right.workspace !== "object" ||
    backup.right.workspace === null
  ) {
    dependencies.setImportNotice("That file is not a valid Recall workspace backup.");
    return;
  }
  const restoredResult = Effect.runSync(
    Effect.either(parseWorkspaceJson(JSON.stringify(backup.right.workspace))),
  );
  if (Either.isLeft(restoredResult)) {
    dependencies.setImportNotice("The backup contains invalid or unsupported workspace data.");
    return;
  }
  const restoredWorkspace: Workspace = restoredResult.right;
  if (
    [...restoredWorkspace.areas, ...(restoredWorkspace.retainedReviewAreas ?? [])].some((item) =>
      item.cards.some((studyCard) => (studyCard.media?.length ?? 0) > 0),
    )
  ) {
    dependencies.setImportNotice(
      "This legacy JSON backup references media without including it; restore a ZIP backup.",
    );
    return;
  }
  const prepared = prepareWorkspaceForSync(restoredResult.right, () => crypto.randomUUID());
  dependencies.requestConfirmation(
    "Replace this tab’s current workspace with the selected backup?",
    () => {
      if (!dependencies.beginContentImport()) return;
      return dependencies.commitContentImport({
        replacement: prepared,
        expectedWorkspace: dependencies.currentWorkspace(),
        message: "Backup loaded into this tab. Syncing it to your account…",
      });
    },
  );
}
