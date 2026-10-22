import type { MediaTrashPurgeResult } from "@recall/application";
import { useState } from "react";
import { useWorkspaceRecovery, type StudyCommandSave } from "@recall/react";
import type { MediaReference, Workspace } from "@recall/domain";
import type { WorkspaceCheckpoint, WorkspaceStore } from "@recall/local-store";
import { Button } from "@recall/ui-web";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@recall/ui-web/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
export function CollectionRecovery({
  workspace,
  store,
  save,
  protectedReferences,
  onPurged,
}: {
  readonly workspace: Workspace;
  readonly store?: WorkspaceStore | undefined;
  readonly save: StudyCommandSave;
  readonly protectedReferences?: readonly MediaReference[] | undefined;
  readonly onPurged?: ((result: MediaTrashPurgeResult) => void) | undefined;
}) {
  const recovery = useWorkspaceRecovery(workspace, store, save, protectedReferences, onPurged);
  const [selected, setSelected] = useState("");
  const [confirm, setConfirm] = useState<"purge" | WorkspaceCheckpoint | null>(null);
  const entry = recovery.entries.find((item) => item.createdAt === selected);
  return (
    <section className="grid gap-4 border-t border-border pt-5" aria-label="Collection recovery">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">Recovery points</h3>
        <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
          {recovery.durable
            ? "Saved on this device every 30 minutes when changes are saved."
            : "Kept in this tab until it closes. Export a workspace backup for lasting recovery."}{" "}
          Attachments use the files already on this device.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {recovery.canCheckStorage && (
          <Button variant="ghost" disabled={recovery.busy} onClick={recovery.checkStorage}>
            Check storage integrity
          </Button>
        )}
        <Select
          value={selected}
          onValueChange={setSelected}
          disabled={recovery.busy || !recovery.entries.length}
        >
          <SelectTrigger className="w-full sm:w-64" aria-label="Recovery point">
            <SelectValue
              placeholder={
                recovery.entries.length ? "Choose a recovery point" : "No recovery points yet"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {recovery.entries.map((item) => (
              <SelectItem key={item.createdAt} value={item.createdAt}>
                {new Date(item.createdAt).toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="secondary"
          disabled={!entry || recovery.busy}
          onClick={() => {
            if (entry) setConfirm(entry);
          }}
        >
          Restore content
        </Button>
        <Button variant="ghost" disabled={recovery.busy} onClick={recovery.repair}>
          Repair missing objective links
        </Button>
        {recovery.canPurge && (
          <Button
            variant="destructive"
            disabled={recovery.busy || !workspace.mediaTrash?.length}
            onClick={() => {
              setConfirm("purge");
            }}
          >
            Empty file trash
          </Button>
        )}
      </div>
      {(recovery.message || recovery.controls.message) && (
        <p role="status" className="text-sm text-muted-foreground">
          {recovery.controls.message || recovery.message}
        </p>
      )}
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "purge"
                ? "Permanently delete unused files?"
                : "Restore earlier content?"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "purge"
                ? "Files still used by cards, history, drafts or recovery points are protected. Other trashed files will be permanently deleted from this device."
                : "Earlier card content and study settings will replace their current versions. Newer cards and review history are preserved. Export a full backup first if you need a separate copy."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirm(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={confirm === "purge" ? "destructive" : "default"}
              onClick={() => {
                if (confirm === "purge") recovery.purge();
                else if (confirm) recovery.restore(confirm);
                setConfirm(null);
              }}
            >
              {confirm === "purge" ? "Delete unused files" : "Restore content"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
