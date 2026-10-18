import { Effect } from "effect";
import { exportDelimitedCards } from "@recall/application";
import { toast } from "@recall/ui-web";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { eraseLocalData } from "@/features/workspace/erase-local-data";
import { exportDashboardWorkspaceBackup } from "@/features/dashboard/transfers/RecallDashboardWorkspaceBackupExport";
import { exportDashboardWorkspaceSnapshot } from "@/features/dashboard/transfers/RecallDashboardWorkspaceSnapshotExport";
import { restoreDashboardWorkspaceBackupFile } from "@/features/dashboard/transfers/RecallDashboardWorkspaceBackupRestore";
import { downloadText } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardCore } from "../state/useRecallDashboardController";
import type { createRecallDashboardContentActions } from "../authoring/actions/RecallDashboardContentActions";
export function createRecallDashboardStorageActions(
  model: Pick<
    RecallDashboardCore & ReturnType<typeof createRecallDashboardContentActions>,
    | "demo"
    | "setImportNotice"
    | "setCacheWritable"
    | "setCacheBlocked"
    | "area"
    | "workspaceRef"
    | "libraryNotes"
    | "pendingReviewRef"
    | "workspace"
    | "cardEditorMounted"
    | "beginContentImport"
    | "failContentImport"
    | "requestConfirmation"
    | "commitContentImport"
  >,
) {
  const {
    demo,
    setImportNotice,
    setCacheWritable,
    setCacheBlocked,
    area,
    workspaceRef,
    libraryNotes,
    pendingReviewRef,
    workspace,
    cardEditorMounted,
    beginContentImport,
    failContentImport,
    requestConfirmation,
    commitContentImport,
  } = model;
  async function discardSavedWorkspace() {
    if (demo) {
      setImportNotice("Mock local cleanup is ready to retry.");
      return;
    }
    setCacheWritable(false);
    setCacheBlocked(true);
    const cleared = await Effect.runPromise(eraseLocalData());
    if (!cleared) {
      setImportNotice(
        "This tab is read-only because its working copy could not be cleared. Retry clearing the tab before continuing.",
      );
      return;
    }
    window.location.reload();
  }
  function exportDelimited(delimiter: "," | "\t") {
    if (!area) return;
    const isTsv = delimiter === "\t";
    const extension = isTsv ? "tsv" : "csv";
    downloadText(
      `${area.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${extension}`,
      exportDelimitedCards(area, delimiter),
      isTsv ? "text/tab-separated-values;charset=utf-8" : "text/csv;charset=utf-8",
    );
    toast.success(`${area.title} exported as ${extension.toUpperCase()}.`);
  }
  function exportWorkspaceSnapshot() {
    exportDashboardWorkspaceSnapshot({
      workspace: workspaceRef.current,
      activityLibrary: libraryNotes.notes.activityLibrary,
      pendingReview: pendingReviewRef.current,
      downloadText,
      onSuccess: toast.success,
      onFailure: toast.error,
    });
  }
  async function exportWorkspaceBackup() {
    await exportDashboardWorkspaceBackup({
      workspace,
      activityLibrary: libraryNotes.notes.activityLibrary,
      notesLoaded: libraryNotes.loaded,
      mediaStore: browserMediaStore,
      setImportNotice,
      onSuccess: toast.success,
      onCancel: toast.message,
      onFailure: toast.error,
    });
  }
  async function restoreWorkspaceBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    await restoreWorkspaceBackupFile(file);
  }
  async function restoreWorkspaceBackupFile(file: File) {
    await restoreDashboardWorkspaceBackupFile(file, {
      isEditorMounted: () => cardEditorMounted.current,
      beginContentImport,
      failContentImport,
      setImportNotice,
      requestConfirmation,
      commitContentImport,
      currentWorkspace: () => workspaceRef.current,
    });
  }
  async function restoreDesktopWorkspaceBackup() {
    const opened = await window.recallDesktop?.backup.open();
    if (
      typeof opened !== "object" ||
      opened === null ||
      !("_tag" in opened) ||
      opened._tag !== "Success" ||
      !("value" in opened)
    ) {
      setImportNotice("The selected backup could not be read.");
      return;
    }
    const value: unknown = opened.value;
    if (value === null) return;
    if (
      typeof value !== "object" ||
      !("name" in value) ||
      typeof value.name !== "string" ||
      !("bytes" in value) ||
      !(value.bytes instanceof Uint8Array)
    ) {
      setImportNotice("The selected backup could not be read.");
      return;
    }
    const fileBytes = new ArrayBuffer(value.bytes.byteLength);
    new Uint8Array(fileBytes).set(value.bytes);
    const file = new File([fileBytes], value.name);
    await restoreWorkspaceBackupFile(file);
  }
  return {
    discardSavedWorkspace,
    exportDelimited,
    exportWorkspaceSnapshot,
    exportWorkspaceBackup,
    restoreWorkspaceBackup,
    restoreWorkspaceBackupFile,
    restoreDesktopWorkspaceBackup,
  } as const;
}
