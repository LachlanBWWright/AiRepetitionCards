import { Effect, Schema } from "effect";
import { CardRefinementResultSchema, CardProposalSchema } from "@recall/ai-core";
import {
  KnowledgeNotebookSchema,
  addNotebookProposal,
  editNotebookProposal,
  type NotebookFailure,
} from "./knowledge-notebook";
const fail = (message: string): NotebookFailure => ({
  _tag: "NotebookFailure",
  reason: "proposal-conflict",
  message,
});
/** Explicit approval only. A stale baseline cannot overwrite newer edits. Splitting retains the original record. */
export function applyNotebookRefinement(
  notebookInput: unknown,
  input: unknown,
  existingCards: unknown = [],
) {
  return Effect.gen(function* () {
    const notebook = yield* Schema.decodeUnknown(KnowledgeNotebookSchema)(notebookInput).pipe(
      Effect.mapError(() => fail("The notebook could not be validated.")),
    );
    const value = yield* Schema.decodeUnknown(
      Schema.Struct({
        proposalId: Schema.UUID,
        baseline: Schema.Struct({
          front: Schema.String,
          back: Schema.String,
          objectiveId: CardProposalSchema.fields.objectiveId,
        }),
        cards: CardRefinementResultSchema.fields.cards,
        newProposalIds: Schema.Array(Schema.UUID).pipe(Schema.maxItems(5)),
      }),
    )(input).pipe(Effect.mapError(() => fail("The proposed refinement is invalid.")));
    const original = notebook.proposals.find((proposal) => proposal.id === value.proposalId);
    if (
      !original ||
      original.status !== "pending" ||
      original.proposal.front !== value.baseline.front ||
      original.proposal.back !== value.baseline.back ||
      original.proposal.objectiveId !== value.baseline.objectiveId
    )
      return yield* Effect.fail(
        fail("This proposal changed while the revision was being prepared. Review a new revision."),
      );
    if (value.cards.some((card) => card.objectiveId !== original.proposal.objectiveId))
      return yield* Effect.fail(fail("A revision must preserve the learning objective."));
    if (value.cards.length === 1) {
      const first = value.cards[0];
      if (!first) return yield* Effect.fail(fail("Select a revision first."));
      const revised = yield* editNotebookProposal(
        notebook,
        { id: original.id, proposal: first },
        existingCards,
      );
      return yield* Schema.decodeUnknown(KnowledgeNotebookSchema)({
        ...revised,
        proposals: revised.proposals.map((proposal) =>
          proposal.id === original.id
            ? {
                ...proposal,
                ...(first.meaningChanged ? { claimId: undefined } : {}),
                sourceReferences:
                  first.sourceReferences.length > 0
                    ? first.sourceReferences
                    : original.sourceReferences,
              }
            : proposal,
        ),
      }).pipe(Effect.mapError(() => fail("The refinement no longer has valid source references.")));
    }
    if (
      value.newProposalIds.length !== value.cards.length ||
      new Set(value.newProposalIds).size !== value.newProposalIds.length
    )
      return yield* Effect.fail(fail("Each split card requires a fresh identity."));
    let next = yield* Schema.decodeUnknown(KnowledgeNotebookSchema)({
      ...notebook,
      proposals: notebook.proposals.map((proposal) =>
        proposal.id === original.id ? { ...proposal, status: "discarded", cardId: null } : proposal,
      ),
    }).pipe(Effect.mapError(() => fail("The original proposal could not be retained.")));
    for (const [index, card] of value.cards.entries()) {
      next = yield* addNotebookProposal(
        next,
        {
          ...original,
          id: value.newProposalIds[index],
          aiRefinementOf: original.id,
          claimId: undefined,
          proposal: card,
          providerSessionId: original.providerSessionId,
          providerResolutionRequired: false,
          sourceReferences:
            card.sourceReferences.length > 0 ? card.sourceReferences : original.sourceReferences,
        },
        existingCards,
      );
    }
    return next;
  });
}
