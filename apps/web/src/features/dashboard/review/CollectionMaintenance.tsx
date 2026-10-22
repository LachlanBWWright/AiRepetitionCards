import type { MediaTrashPurgeResult } from "@recall/application";
import { CollectionRecovery } from "./CollectionRecovery";
import { useCollectionHealth, type StudyCommandSave } from "@recall/react";
import type { Workspace, MediaReference } from "@recall/domain";
import type { MediaStore, WorkspaceStore } from "@recall/local-store";
import { ScanSearch, ArchiveRestore, LoaderCircle, CircleCheck } from "lucide-react";
import { Button } from "@recall/ui-web";
import type { CollectionHealth } from "@recall/application";

export function CollectionMaintenance({
  workspace,
  media,
  save,
  protectedReferences,
  workspaceStore,
  onPurged,
}: {
  readonly workspaceStore?: WorkspaceStore | undefined;
  readonly onPurged?: ((result: MediaTrashPurgeResult) => void) | undefined;
  readonly protectedReferences?: readonly MediaReference[] | undefined;
  readonly workspace: Workspace;
  readonly media: MediaStore;
  readonly save: StudyCommandSave;
}) {
  const health = useCollectionHealth(workspace, media, save, protectedReferences);
  return (
    <section className="grid gap-6" aria-label="Collection maintenance">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid max-w-sm gap-2">
          <h3 className="text-lg font-semibold tracking-tight">Keep your collection in shape</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Find missing attachments and cards that need attention. Saved versions and drafts keep
            their files protected.
          </p>
        </div>
        <Button variant="secondary" className="gap-2" disabled={health.busy} onClick={health.scan}>
          {health.busy ? (
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <ScanSearch className="size-4" aria-hidden="true" />
          )}
          {health.busy ? "Checking…" : "Check collection"}
        </Button>
      </div>
      {health.report && (
        <>
          <HealthReport report={health.report} workspace={workspace} />
          <CleanupActions
            report={health.report}
            busy={health.controls.busy}
            onAction={health.act}
          />
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <div className="grid gap-1">
          <p className="text-sm font-medium">
            Recoverable trash
            {health.trashCount > 0 ? ` (${String(health.trashCount)} files)` : " is empty"}
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            Trashed files stay on this device. This keeps cleanup reversible and does not free
            storage.
          </p>
        </div>
        {health.trashCount > 0 && (
          <Button
            variant="ghost"
            className="gap-2"
            disabled={health.controls.busy}
            onClick={() => {
              health.act("restore");
            }}
          >
            <ArchiveRestore className="size-4" aria-hidden="true" /> Restore files
          </Button>
        )}
      </div>
      <CollectionRecovery
        workspace={workspace}
        store={workspaceStore}
        save={save}
        protectedReferences={protectedReferences}
        onPurged={onPurged}
      />
      {(health.message || health.controls.message) && (
        <p className="text-sm text-muted-foreground" role="status">
          {health.controls.message || health.message}
        </p>
      )}
    </section>
  );
}
function HealthReport({
  report,
  workspace,
}: {
  readonly report: CollectionHealth;
  readonly workspace: Workspace;
}) {
  const counts = [
    ["Missing files", report.missing.length],
    ["Damaged files", report.corrupt.length],
    ["Unused files", report.unused.length],
    ["Cards to check", report.issues.length],
  ] as const;
  const healthy = !report.missing.length && !report.corrupt.length && !report.issues.length;
  return (
    <div className="grid gap-4">
      <dl className="grid gap-x-8 gap-y-3 border-y border-border py-4 sm:grid-cols-2">
        {counts.map(([label, count]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
      {healthy && (
        <p className="flex items-center gap-2 text-sm">
          <CircleCheck className="size-4 text-primary" aria-hidden="true" />
          {report.checkedAssets
            ? `All ${String(report.checkedAssets)} stored files checked. No card issues found.`
            : "No stored attachments to check. No card issues found."}
        </p>
      )}
      <ul className="grid max-h-64 gap-3 overflow-y-auto text-sm">
        {report.issues.map((issue, index) => {
          const card = workspace.areas
            .find((area) => area.id === issue.areaId)
            ?.cards.find((item) => item.id === issue.cardId);
          return (
            <li
              key={`${issue.cardId}:${String(index)}`}
              className="grid gap-1 border-b border-border pb-3"
            >
              <p className="truncate font-medium">
                {card?.front.trim().slice(0, 90) || "Untitled card"}
              </p>
              <p className="text-muted-foreground">{issue.message}</p>
            </li>
          );
        })}
        {[
          ...report.missing.map((reference) => ({ reference, label: "Missing" })),
          ...report.corrupt.map((reference) => ({ reference, label: "Damaged" })),
        ].map(({ reference, label }) => (
          <li
            key={`${label}:${reference.id}`}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3"
          >
            <span>
              {label} {reference.mimeType.startsWith("image/") ? "image" : "audio"}
            </span>
            <span className="text-xs text-muted-foreground">File {reference.id.slice(0, 12)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CleanupActions({
  report,
  busy,
  onAction,
}: {
  readonly report: CollectionHealth;
  readonly busy: boolean;
  readonly onAction: (action: "trash" | "tag-missing") => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {report.unused.length > 0 && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            onAction("trash");
          }}
        >
          Move {report.unused.length} unused files to trash
        </Button>
      )}
      {report.missing.length > 0 && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            onAction("tag-missing");
          }}
        >
          Tag cards with missing files
        </Button>
      )}
    </div>
  );
}
