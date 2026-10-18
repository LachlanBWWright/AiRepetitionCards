import { Effect, Either, Schema } from "effect";
import {
  createKnowledgeNotebookTutor,
  findCardDuplicates,
  proposalDuplicateCandidates,
  type NotebookProposal,
  editNotebookProposal,
  markNotebookProposalAcknowledged,
  resolveNotebookProposal,
} from "@recall/application";
import { CardProposalSchema } from "@recall/ai-core";
import type { NativeNotebookState } from "../useNativeKnowledgeNotebookState";
import type { createNativeKnowledgeNotebookPracticeActions } from "../practice/NativeKnowledgeNotebookPracticeActions";
export function createNativeKnowledgeNotebookProposalActions(
  context: NativeNotebookState &
    Pick<ReturnType<typeof createNativeKnowledgeNotebookPracticeActions>, "persistBeforeRequest">,
) {
  const {
    notebook,
    pendingProposal,
    proposalContent,
    area,
    setNotice,
    save,
    setProposalDraft,
    api,
    unsaved,
    mayWrite,
    runAction,
    persistBeforeRequest,
    onApproveProposal,
    notebookRef,
  } = context;
  async function saveProposalEdits() {
    if (!notebook || !pendingProposal || !proposalContent) return;
    const edited = Effect.runSync(
      Effect.either(
        editNotebookProposal(
          notebook,
          { id: pendingProposal.id, proposal: proposalContent },
          area.cards,
        ),
      ),
    );
    if (Either.isLeft(edited)) setNotice(edited.left.message);
    else if (await save(edited.right)) {
      setProposalDraft(null);
      setNotice("Proposal edits saved locally.");
    }
  }
  async function proposeBatch() {
    if (!notebook || !api || unsaved || !mayWrite()) return;
    await runAction(async (isCurrent) => {
      const ids = notebook.evidence
        .filter(
          (entry) =>
            entry.kind === "tutor" &&
            entry.evaluation.suggestedAction === "propose-card" &&
            !notebook.proposals.some(
              (proposal) =>
                proposal.status !== "discarded" && proposal.evidenceIds.includes(entry.id),
            ),
        )
        .map((entry) => entry.id)
        .slice(0, 100);
      const result = await Effect.runPromise(
        Effect.either(
          createKnowledgeNotebookTutor(api, persistBeforeRequest).proposeBatch(
            notebook,
            ids,
            area.cards,
            Date.now,
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) {
        if (result.left.notebook) await save(result.left.notebook);
        setNotice(result.left.message);
      } else await save(result.right);
    });
  }
  async function resolveProposal(status: "accepted" | "discarded") {
    await runAction(async (isCurrent) => resolveProposalAction(status, isCurrent));
  }
  async function resolveProposalAction(
    status: "accepted" | "discarded",
    isCurrent: () => boolean,
    selection?: NotebookProposal,
  ) {
    const notebook = notebookRef.current;
    const pendingProposal = selection ?? context.pendingProposal;
    const proposalContent = selection ? selection.proposal : context.proposalContent;
    const duplicatesAllowed = selection
      ? findCardDuplicates(selection.proposal, [
          ...context.duplicateCandidates,
          ...proposalDuplicateCandidates(
            (notebook?.proposals ?? [])
              .filter((entry) => entry.id !== selection.id && entry.status !== "discarded")
              .map((entry) => ({ id: `proposal:${entry.id}`, proposal: entry.proposal })),
          ),
        ]).length === 0
      : context.duplicatesAllowed;
    if (!notebook || !pendingProposal || unsaved || !mayWrite()) return;
    if (status === "accepted") {
      if (!duplicatesAllowed) {
        setNotice("Review the possible duplicates and choose Keep both before saving.");
        return;
      }
      const edited = Schema.decodeUnknownEither(CardProposalSchema)({
        ...proposalContent,
        front: proposalContent?.front.trim(),
        back: proposalContent?.back.trim(),
        rationale: proposalContent?.rationale.trim(),
      });
      if (
        Either.isLeft(edited) ||
        (edited.right.objectiveId !== null &&
          !area.objectives.some((objective) => objective.id === edited.right.objectiveId))
      ) {
        setNotice("Review the question, answer, rationale and learning objective before saving.");
        return;
      }
      if (!pendingProposal.providerSessionId) {
        setNotice("This proposal is missing its session identity and cannot be approved.");
        return;
      }
      const saved = await onApproveProposal(
        edited.right,
        pendingProposal.id,
        pendingProposal.providerSessionId,
      );
      if (!isCurrent()) return;
      if (!saved) {
        setNotice("The proposal was not approved because its card could not be saved locally.");
        return;
      }
      const approved = Effect.runSync(
        Effect.either(
          resolveNotebookProposal(notebook, {
            id: pendingProposal.id,
            status: "accepted",
            cardId: saved.cardId,
            proposal: saved.content,
          }),
        ),
      );
      if (Either.isRight(approved)) {
        if (await save(approved.right))
          await acknowledgeProposal(
            approved.right.proposals.find((item) => item.id === pendingProposal.id) ??
              pendingProposal,
            isCurrent,
            approved.right,
          );
      } else
        setNotice(
          "The card is saved, but the notebook link could not be updated. Retry after refreshing.",
        );
      return;
    }
    const locallyDiscarded = Effect.runSync(
      Effect.either(
        resolveNotebookProposal(notebook, { id: pendingProposal.id, status: "discarded" }),
      ),
    );
    if (Either.isLeft(locallyDiscarded) || !(await save(locallyDiscarded.right))) return;
    if (
      !api ||
      !pendingProposal.providerSessionId ||
      pendingProposal.providerResolutionRequired === false
    )
      return;
    const rejected = await Effect.runPromise(
      Effect.either(api.resolveProposal({ proposalId: pendingProposal.id, state: "rejected" })),
    );
    if (!isCurrent()) return;
    if (Either.isLeft(rejected)) {
      setNotice("The proposal could not be discarded on the tutor service.");
      return;
    }
    const acknowledged = Effect.runSync(
      Effect.either(markNotebookProposalAcknowledged(locallyDiscarded.right, pendingProposal.id)),
    );
    if (Either.isRight(acknowledged)) await save(acknowledged.right);
  }
  async function acknowledgeProposal(
    proposal: NonNullable<typeof pendingProposal>,
    isCurrent: () => boolean,
    base = notebookRef.current,
  ) {
    if (
      !api ||
      !proposal.providerSessionId ||
      !base ||
      proposal.providerResolutionRequired === false
    )
      return;
    const result = await Effect.runPromise(
      Effect.either(
        api.resolveProposal({
          proposalId: proposal.id,
          state: proposal.status === "accepted" ? "approved" : "rejected",
          ...(proposal.status === "accepted"
            ? { cardId: proposal.cardId ?? undefined, content: proposal.proposal }
            : {}),
        }),
      ),
    );
    if (!isCurrent()) return;
    if (Either.isLeft(result)) {
      setNotice("The decision is saved locally. Retry acknowledgement with the tutor.");
      return;
    }
    const current = notebookRef.current ?? base;
    const marked = Effect.runSync(
      Effect.either(markNotebookProposalAcknowledged(current, proposal.id)),
    );
    if (Either.isRight(marked)) await save(marked.right);
  }
  async function approveSelected(ids: readonly string[]) {
    if (unsaved || !mayWrite()) return;
    await runAction(async (isCurrent) => {
      for (const id of ids) {
        if (!isCurrent()) return;
        const entry = notebookRef.current?.proposals.find(
          (proposal) => proposal.id === id && proposal.status === "pending",
        );
        if (!entry) continue;
        await resolveProposalAction("accepted", isCurrent, entry);
        if (
          notebookRef.current?.proposals.find((proposal) => proposal.id === id)?.status !==
          "accepted"
        )
          return;
      }
    });
  }
  return {
    saveProposalEdits,
    proposeBatch,
    resolveProposal,
    acknowledgeProposal,
    approveSelected,
  } as const;
}
