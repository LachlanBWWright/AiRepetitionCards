"use client";
import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import {
  requestReviewRepair,
  prepareReviewRepairCommand,
  reviewRepairHasDuplicates,
  workspaceAuthoringBaseline,
  type ReviewRepairAction,
  type ReviewRepairResult,
} from "@recall/application";
import type { Assessment, LearningArea, Workspace } from "@recall/domain";
import type { StudyCommandSave } from "../study/use-study-command";

export function useReviewRepair({
  api,
  workspace,
  area,
  card,
  save,
  disabled,
  createId,
  clock,
}: {
  readonly api: Parameters<typeof requestReviewRepair>[0] | null;
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly card: Assessment;
  readonly save: StudyCommandSave | undefined;
  readonly disabled: boolean;
  readonly createId: () => string;
  readonly clock: () => number;
}) {
  const [proposal, setProposal] = useState<{
    readonly result: ReviewRepairResult;
    readonly baseline: Workspace;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const pending = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = (operation: Effect.Effect<void, { readonly message: string }>) => {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    setMessageIsError(false);
    Effect.runFork(
      operation.pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            if (alive.current) {
              setMessage(error.message);
              setMessageIsError(true);
            }
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            pending.current = false;
            if (alive.current) setBusy(false);
          }),
        ),
      ),
    );
  };
  const request = (action: ReviewRepairAction) => {
    if (!api) return;
    run(
      requestReviewRepair(api, area, card, action, clock()).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (alive.current) {
              setProposal({ result, baseline: workspace });
              setAllowDuplicates(false);
            }
          }),
        ),
        Effect.asVoid,
      ),
    );
  };
  const duplicates =
    proposal?.result.kind === "cards" &&
    reviewRepairHasDuplicates(workspace, card.id, proposal.result);
  const canApprove =
    Boolean(save) &&
    !disabled &&
    !busy &&
    proposal?.result.kind === "cards" &&
    (!duplicates || allowDuplicates);
  const approve = () => {
    if (!proposal || proposal.result.kind !== "cards" || !save) return;
    if (!canApprove) return;
    const { result, baseline } = proposal;
    const original = baseline.areas
      .find((item) => item.id === area.id)
      ?.cards.find((item) => item.id === card.id);
    if (!original) return;
    run(
      prepareReviewRepairCommand(
        baseline,
        area.id,
        original,
        result.action,
        result.refinement,
        createId,
        allowDuplicates,
      ).pipe(
        Effect.flatMap((command) => save(command, workspaceAuthoringBaseline(baseline, command))),
        Effect.tap(() =>
          Effect.sync(() => {
            if (alive.current) {
              setProposal(null);
              setMessage("Approved cards saved. Original review history is preserved.");
            }
          }),
        ),
        Effect.asVoid,
      ),
    );
  };
  return {
    proposal: proposal?.result ?? null,
    visibleProposal: busy ? null : (proposal?.result ?? null),
    canApprove,
    messageIsError,
    original:
      proposal?.baseline.areas
        .find((item) => item.id === area.id)
        ?.cards.find((item) => item.id === card.id) ?? card,
    message,
    busy,
    request,
    approve,
    allowDuplicates,
    setAllowDuplicates,
    duplicates,
    discard: () => {
      if (pending.current) return;
      setProposal(null);
      setAllowDuplicates(false);
    },
  };
}
