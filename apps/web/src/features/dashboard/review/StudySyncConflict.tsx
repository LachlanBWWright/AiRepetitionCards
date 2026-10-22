import type { Workspace } from "@recall/domain";
import { useStudyCommand, type StudyCommandSave } from "@recall/react";
import { Button } from "@recall/ui-web";
export function StudySyncConflict({
  workspace,
  save,
}: {
  readonly workspace: Workspace;
  readonly save: StudyCommandSave;
}) {
  const controls = useStudyCommand(workspace, save);
  const conflict = workspace.studySettingsConflict;
  if (!conflict) return null;
  return (
    <section className="grid gap-3 border p-3" aria-label="Study settings conflict">
      <h3 className="font-semibold">Study settings changed on another device</h3>
      <p>
        Synced settings are active. Your device settings have been kept below for comparison. Choose
        which set to retain, then sync again.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <h4>This device</h4>
          <pre className="max-h-64 overflow-auto text-xs">
            {JSON.stringify(conflict.local, null, 2)}
          </pre>
        </div>
        <div>
          <h4>Synced settings</h4>
          <pre className="max-h-64 overflow-auto text-xs">
            {JSON.stringify(conflict.remote, null, 2)}
          </pre>
        </div>
      </div>
      <Button
        variant="secondary"
        disabled={controls.busy}
        onClick={() => {
          controls.commit({ kind: "resolve-study-settings", choice: "local" });
        }}
      >
        Use this device settings
      </Button>
      <Button
        variant="secondary"
        disabled={controls.busy}
        onClick={() => {
          controls.commit({ kind: "resolve-study-settings", choice: "remote" });
        }}
      >
        Keep synced settings
      </Button>
      {controls.message && <p role="status">{controls.message}</p>}
    </section>
  );
}
