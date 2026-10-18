import { Effect, Schema } from "effect";
import {
  editNotebookProposal,
  markNotebookProposalAcknowledged,
  resolveNotebookProposal,
  type NotebookProposal,
} from "@recall/application";
import { CardProposalSchema, cardIdForTutorProposal, type CardProposal } from "@recall/ai-core";
import { createAssessmentId } from "@recall/domain";
import type { KnowledgeNotebookState } from "../useKnowledgeNotebookState";
const rejectedProposalConfirmationMessage =
  "The proposal is discarded locally. Retry confirmation when your tutor connection is available.";
const failedCardSaveMessage = "The card could not be saved. Your proposal remains available.";
const savedCardConfirmationMessage =
  "Your card is saved. Retry confirmation when the tutor connection is available.";
export function createKnowledgeNotebookProposalActions(
  model: Pick<
    KnowledgeNotebookState,
    | "setDrafts"
    | "current"
    | "run"
    | "drafts"
    | "knowledgeArea"
    | "save"
    | "alive"
    | "demo"
    | "api"
    | "proposalDuplicates"
    | "onApprove"
  >,
) {
  const {
    setDrafts,
    current,
    run,
    drafts,
    knowledgeArea,
    save,
    alive,
    demo,
    api,
    proposalDuplicates,
    onApprove,
  } = model;
  function editProposal(id: string, draft: CardProposal) {
    setDrafts((existing) => ({ ...existing, [id]: draft }));
  }
  function saveProposalEdits(entry: NotebookProposal) {
    const existing = current.current;
    if (!existing) return;
    run(
      editNotebookProposal(
        existing,
        { id: entry.id, proposal: drafts[entry.id] ?? entry.proposal },
        knowledgeArea.cards,
      ).pipe(Effect.flatMap(save)),
      () => {
        setDrafts((previous) => {
          return Object.fromEntries(Object.entries(previous).filter(([id]) => id !== entry.id));
        });
      },
    );
  }
  function resolveOperation(entry: NotebookProposal, decision: "accepted" | "discarded") {
    return Effect.suspend(() => {
      const existing = current.current;
      if (!existing)
        return Effect.fail({ message: "Load this notebook before approving proposals." });
      const epoch = alive.current;
      return Effect.gen(function* () {
        if (decision === "discarded") {
          const discarded = yield* resolveNotebookProposal(existing, {
            id: entry.id,
            status: "discarded",
          });
          yield* save(discarded, epoch);
          if (!demo && entry.providerResolutionRequired !== false)
            yield* api.resolveProposal({ proposalId: entry.id, state: "rejected" }).pipe(
              Effect.mapError(() => ({
                message: rejectedProposalConfirmationMessage,
              })),
            );
          const acknowledged = yield* markNotebookProposalAcknowledged(discarded, entry.id);
          return yield* save(acknowledged, epoch);
        }
        const draft = yield* Schema.decodeUnknown(CardProposalSchema)(
          drafts[entry.id] ?? entry.proposal,
        ).pipe(
          Effect.mapError(() => ({
            message:
              "Complete the question, answer and rationale within the field limits before approval.",
          })),
        );
        const duplicates = proposalDuplicates(entry, draft);
        if (entry.status === "pending" && duplicates.matches.length > 0 && !duplicates.acknowledged)
          return yield* Effect.fail({
            message: "Review the possible duplicates and choose Keep both before saving.",
          });
        const cardId = cardIdForTutorProposal(entry.id);
        const providerSessionId = entry.providerSessionId;
        if (!cardId || !providerSessionId)
          return yield* Effect.fail({
            message:
              "This proposal has no valid tutor session. Keep your notebook and generate a new proposal from its evidence.",
          });
        if (epoch !== alive.current)
          return yield* Effect.fail({
            message:
              "This investigation view changed. Reopen the saved notebook before approving cards.",
          });
        const prepared =
          entry.status === "pending"
            ? yield* editNotebookProposal(
                existing,
                { id: entry.id, proposal: draft },
                knowledgeArea.cards,
              ).pipe(Effect.flatMap((next) => save(next, epoch)))
            : existing;
        const canonical =
          entry.status === "accepted"
            ? entry.proposal
            : yield* Effect.tryPromise({
                try: () => onApprove(draft, cardId, entry.id, providerSessionId),
                catch: () => ({ message: failedCardSaveMessage }),
              });
        if (!canonical)
          return yield* Effect.fail({
            message: "The card was not saved. Your proposal and edits remain available to retry.",
          });
        let next = yield* resolveNotebookProposal(prepared, {
          id: entry.id,
          status: "accepted",
          cardId: createAssessmentId(cardId),
          proposal: canonical,
        });
        next = yield* save(next, epoch);
        if (!demo && entry.providerResolutionRequired !== false)
          yield* api
            .resolveProposal({
              proposalId: entry.id,
              state: "approved",
              cardId,
              content: canonical,
            })
            .pipe(
              Effect.mapError(() => ({
                message: savedCardConfirmationMessage,
              })),
            );
        next = yield* markNotebookProposalAcknowledged(next, entry.id);
        return yield* save(next, epoch);
      });
    });
  }
  function resolve(entry: NotebookProposal, decision: "accepted" | "discarded") {
    run(resolveOperation(entry, decision));
  }
  function approveSelected(ids: readonly string[]) {
    const entries =
      current.current?.proposals.filter(
        (entry) => entry.status === "pending" && ids.includes(entry.id),
      ) ?? [];
    if (entries.length === 0) return;
    run(
      Effect.forEach(entries, (entry) => resolveOperation(entry, "accepted"), {
        concurrency: 1,
      }).pipe(
        Effect.map((results) => results[results.length - 1] ?? current.current),
        Effect.flatMap((notebook) =>
          notebook
            ? Effect.succeed(notebook)
            : Effect.fail({ message: "Load this notebook before approving proposals." }),
        ),
      ),
    );
  }
  return { editProposal, saveProposalEdits, resolve, approveSelected } as const;
}
