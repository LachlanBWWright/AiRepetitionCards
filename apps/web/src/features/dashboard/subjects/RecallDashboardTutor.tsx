import { Effect, Either } from "effect";
import { persistTutorCardApproval } from "@recall/application";
import { browserWorkspaceStore } from "@/features/workspace/browser-workspace-store";
import { type CardProposal } from "@recall/ai-core";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
import { RecallSubjectAIViews } from "./RecallSubjectAIViews";
export function RecallDashboardTutor({ model }: { readonly model: RecallDashboardModel }) {
  const {
    area,
    cacheWritable,
    ready,
    setImportNotice,
    enqueueWorkspaceSave,
    workspaceRef,
    setWorkspace,
  } = model;
  async function onApprove(
    proposal: CardProposal,
    _cardId: string,
    proposalId: string,
    sessionId: string,
    targetAreaId: string | undefined = area?.id,
  ) {
    if (!targetAreaId || !cacheWritable || !ready) {
      setImportNotice("Local storage must be available before approving an AI card.");
      return null;
    }
    return enqueueWorkspaceSave(async () => {
      for (;;) {
        const current = workspaceRef.current;
        const saved = await Effect.runPromise(
          Effect.either(
            persistTutorCardApproval(
              browserWorkspaceStore,
              current,
              { areaId: targetAreaId, proposal, proposalId, sessionId },
              new Date(),
            ),
          ),
        );
        if (Either.isLeft(saved)) {
          setImportNotice(saved.left.message);
          return null;
        }
        if (workspaceRef.current !== current) continue;
        setWorkspace(saved.right.workspace);
        setImportNotice("Card saved.");
        return saved.right.proposal;
      }
    });
  }
  return <RecallSubjectAIViews model={model} onApprove={onApprove} />;
}
