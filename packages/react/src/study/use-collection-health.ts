"use client";
import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import type { Workspace, MediaReference } from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import { inspectCollection, type CollectionHealth } from "@recall/application";
import { useStudyCommand, type StudyCommandSave } from "./use-study-command";
export function useCollectionHealth(
  workspace: Workspace,
  media: MediaStore | undefined,
  save: StudyCommandSave | undefined,
  protectedReferences: readonly MediaReference[] = [],
) {
  const controls = useStudyCommand(workspace, save);
  const [report, setReport] = useState<CollectionHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  const scanning = useRef(false);
  const protectedKey = JSON.stringify(protectedReferences);
  const latest = useRef({ workspace, protectedKey });
  useEffect(() => {
    latest.current = { workspace, protectedKey };
  }, [workspace, protectedKey]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const scan = () => {
    if (!media || scanning.current) return;
    const original = workspace;
    scanning.current = true;
    setBusy(true);
    setMessage("");
    void Effect.runPromise(
      Effect.either(inspectCollection(original, media, protectedReferences)),
    ).then((result) => {
      scanning.current = false;
      if (!alive.current) return;
      setBusy(false);
      if (latest.current.workspace !== original || latest.current.protectedKey !== protectedKey) {
        setMessage("The collection changed during the scan. Run it again.");
        return;
      }
      if (result._tag === "Left") {
        setMessage(result.left.message);
        return;
      }
      setReport(result.right);
      setMessage("Scan complete. Re-scan after editing or changing media.");
    });
  };
  const act = (action: "trash" | "restore" | "tag-missing") => {
    const references =
      action === "restore"
        ? (workspace.mediaTrash?.map((item) => item.reference) ?? [])
        : action === "trash"
          ? (report?.unused ?? []).filter(
              (reference) => !protectedReferences.some((item) => item.id === reference.id),
            )
          : (report?.missing ?? []);
    if (!references.length) return;
    controls.commit(
      { kind: "maintain-collection-media", action, references },
      action === "trash"
        ? "Unused files moved to recoverable trash. Files remain on this device."
        : action === "restore"
          ? "Files restored from trash."
          : "Affected cards tagged missing-media.",
    );
  };
  return {
    report,
    busy,
    message,
    scan,
    act,
    controls,
    trashCount: workspace.mediaTrash?.length ?? 0,
    available: Boolean(media),
  };
}
