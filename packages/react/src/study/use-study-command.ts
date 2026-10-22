"use client";

import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import {
  workspaceAuthoringBaseline,
  suspensionSettings,
  type WorkspaceAuthoringCommand,
} from "@recall/application";
import type { AssessmentId, Workspace } from "@recall/domain";
export type StudyCommandSave = (
  command: WorkspaceAuthoringCommand,
  baseline?: string,
) => Effect.Effect<unknown, { readonly message: string }>;
export function useStudyCommand(workspace: Workspace, save: StudyCommandSave | undefined) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const commit = (command: WorkspaceAuthoringCommand, success = "Changes saved.") => {
    if (!save || saving.current) return;
    saving.current = true;
    setBusy(true);
    setMessage("");
    void Effect.runPromise(
      Effect.either(save(command, workspaceAuthoringBaseline(workspace, command))),
    ).then((result) => {
      saving.current = false;
      if (!alive.current) return;
      setBusy(false);
      setMessage(Either.isLeft(result) ? result.left.message : success);
    });
  };
  const toggleSuspension = (cardId: AssessmentId) => {
    commit(
      { kind: "update-scheduler-settings", settings: suspensionSettings(workspace, cardId) },
      "Card suspension updated. Review history is preserved.",
    );
  };
  return { busy, message, commit, toggleSuspension };
}
export type StudyCommandPromiseSave = (
  command: WorkspaceAuthoringCommand,
  baseline?: string,
) => Promise<{ readonly ok: boolean; readonly message: string }>;
/** Adapt the native host's existing promise boundary into the shared typed save operation. */
export function adaptStudyCommandSave(save: StudyCommandPromiseSave): StudyCommandSave {
  return (command, baseline) =>
    Effect.tryPromise({
      try: () => save(command, baseline),
      catch: () => ({ message: "The change could not be saved. Retry after checking storage." }),
    }).pipe(
      Effect.flatMap((result) =>
        result.ok ? Effect.succeed(result) : Effect.fail({ message: result.message }),
      ),
    );
}
