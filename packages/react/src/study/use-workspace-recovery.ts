"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Effect } from "effect";
import type { Workspace, MediaReference } from "@recall/domain";
import type { WorkspaceCheckpoint, WorkspaceStore } from "@recall/local-store";
import { purgeMediaTrash, type MediaTrashPurgeResult } from "@recall/application";
import { useStudyCommand, type StudyCommandSave } from "./use-study-command";
export function useWorkspaceRecovery(
  workspace: Workspace,
  store: WorkspaceStore | undefined,
  save: StudyCommandSave | undefined,
  protectedReferences: readonly MediaReference[] = [],
  onPurged?: (result: MediaTrashPurgeResult) => void,
) {
  const controls = useStudyCommand(workspace, save);
  const [entries, setEntries] = useState<readonly WorkspaceCheckpoint[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const latest = useRef(protectedReferences);
  useLayoutEffect(() => {
    latest.current = protectedReferences;
  }, [protectedReferences]);
  useEffect(() => {
    alive.current = true;
    const checkpoints = store?.checkpoints;
    if (checkpoints)
      void Effect.runPromise(Effect.either(checkpoints.read)).then((result) => {
        if (!alive.current) return;
        if (result._tag === "Right") setEntries(result.right);
        else setMessage("Recovery points could not be read.");
      });
    return () => {
      alive.current = false;
    };
  }, [store, workspace]);
  const checkStorage = () => {
    if (!store?.checkIntegrity || busy) return;
    setBusy(true);
    void Effect.runPromise(Effect.either(store.checkIntegrity)).then((result) => {
      if (!alive.current) return;
      setBusy(false);
      setMessage(
        result._tag === "Right"
          ? "Storage integrity check passed."
          : "Storage needs attention. Export a backup before attempting recovery.",
      );
    });
  };
  const purge = () => {
    if (!store || busy || !onPurged) return;
    setBusy(true);
    void Effect.runPromise(Effect.either(purgeMediaTrash(store, () => latest.current))).then(
      (result) => {
        if (result._tag === "Right") onPurged(result.right);
        if (!alive.current) return;
        setBusy(false);
        if (result._tag === "Left") setMessage(result.left.message);
        else {
          setMessage(
            result.right.removed
              ? `${String(result.right.removed)} files permanently removed.`
              : "These files are protected by content, drafts or recovery points.",
          );
        }
      },
    );
  };
  return {
    entries,
    checkStorage,
    canCheckStorage: Boolean(store?.checkIntegrity && store.checkpoints?.durable),
    message,
    busy: busy || controls.busy,
    controls,
    purge,
    durable: store?.checkpoints?.durable ?? false,
    canPurge: Boolean(store?.coordinateMediaCommit && onPurged),
    restore: (entry: WorkspaceCheckpoint) => {
      controls.commit(
        { kind: "restore-workspace-checkpoint", serializedWorkspace: entry.serializedWorkspace },
        "Checkpoint restored. Newer cards and review history were preserved.",
      );
    },
    repair: () => {
      controls.commit(
        { kind: "repair-collection-references" },
        "Missing objective links repaired. Review history was preserved.",
      );
    },
  };
}
