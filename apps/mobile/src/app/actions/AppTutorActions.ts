import { Effect, Either } from "effect";
import { persistTutorCardApproval } from "@recall/application";
import { type CardProposal } from "@recall/ai-core";
import type { AppCoreState } from "../useAppController";

export function createAppTutorActions(
  model: Pick<
    AppCoreState,
    | "operationGeneration"
    | "authSession"
    | "activeArea"
    | "store"
    | "cacheWritable"
    | "setMessage"
    | "workspaceLifetime"
    | "workspaceChangeLane"
    | "workspaceRef"
    | "setWorkspace"
  >,
) {
  const {
    operationGeneration,
    authSession,
    activeArea,
    store,
    cacheWritable,
    setMessage,
    workspaceLifetime,
    workspaceChangeLane,
    workspaceRef,
    setWorkspace,
  } = model;
  async function approveTutorProposal(
    proposal: CardProposal,
    proposalId: string,
    sessionId: string,
    targetAreaId: string | undefined = activeArea?.id,
  ): Promise<{ readonly cardId: string; readonly content: CardProposal } | null> {
    const generation = operationGeneration;
    const authGeneration = authSession.current.generation;
    if (!targetAreaId || !store || !cacheWritable) {
      setMessage("Local storage must be available before approving an AI card.");
      return null;
    }
    const areaId = targetAreaId;
    const isCurrent = () =>
      workspaceLifetime.generation() === generation &&
      !workspaceLifetime.isBlocked() &&
      authSession.current.generation === authGeneration;
    const saved = await Effect.runPromise(
      Effect.either(
        workspaceChangeLane.withPermits(1)(
          Effect.gen(function* () {
            const current = workspaceRef.current;
            if (!current || !isCurrent())
              return yield* Effect.fail({ _tag: "NativeWorkspaceUnavailable" } as const);
            const approved = yield* persistTutorCardApproval(
              store,
              current,
              { areaId, proposal, proposalId, sessionId },
              new Date(),
            );
            if (!isCurrent())
              return yield* Effect.fail({ _tag: "NativeWorkspaceUnavailable" } as const);
            setWorkspace(approved.workspace);
            return approved;
          }),
        ),
      ),
    );
    if (Either.isLeft(saved)) {
      setMessage(
        saved.left._tag === "NativeWorkspaceUnavailable"
          ? "Approval was discarded because this workspace or account changed. Retry in the current session."
          : saved.left.message,
      );
      return null;
    }
    return { cardId: saved.right.cardId, content: saved.right.proposal };
  }
  return { approveTutorProposal } as const;
}
