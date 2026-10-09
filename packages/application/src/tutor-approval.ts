import { Effect, Schema } from "effect";
import { CardProposalSchema, cardIdForTutorProposal } from "@recall/ai-core";
import {
  AreaIdSchema,
  TutorSessionIdSchema,
  ProposalIdSchema,
  WorkspaceSchema,
} from "@recall/domain";
import type { WorkspaceStore } from "@recall/local-store";
import { createStudyCard } from "./card-management";
import { saveWorkspace } from "./workspace-persistence";
import { refinementCardContent } from "./workspace-authoring";

const ApprovalSchema = Schema.Struct({
  areaId: AreaIdSchema,
  sessionId: TutorSessionIdSchema.pipe(
    Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  ),
  proposalId: ProposalIdSchema,
  proposal: CardProposalSchema,
});
export type TutorApprovalFailure = {
  readonly _tag: "TutorApprovalFailure";
  readonly message: string;
};
const failure = (message: string): TutorApprovalFailure => ({
  _tag: "TutorApprovalFailure",
  message,
});

/** Retrying an unchanged approval preserves the original schedule and review history. */
export function prepareTutorCardApproval(workspaceInput: unknown, input: unknown, now: Date) {
  return Effect.gen(function* () {
    const workspace = yield* Schema.decodeUnknown(WorkspaceSchema)(workspaceInput).pipe(
      Effect.mapError(() => failure("This workspace contains invalid data.")),
    );
    const command = yield* Schema.decodeUnknown(ApprovalSchema)(input).pipe(
      Effect.mapError(() => failure("This proposal could not be validated.")),
    );
    const cardId = cardIdForTutorProposal(command.proposalId);
    if (!cardId) return yield* Effect.fail(failure("This proposal has an invalid identifier."));
    const sourceId = `tutor:${command.sessionId}:${command.proposalId}`;
    const existing = workspace.areas
      .flatMap((area) => area.cards.map((card) => ({ area, card })))
      .filter(({ card }) => card.id === cardId || card.sourceId === sourceId);
    if (existing.length > 0) {
      const match = existing[0];
      if (
        existing.length !== 1 ||
        !match ||
        match.area.id !== command.areaId ||
        match.card.id !== cardId ||
        match.card.sourceId !== sourceId ||
        match.card.origin !== "ai-generated"
      )
        return yield* Effect.fail(
          failure("This proposal conflicts with an existing card identity."),
        );
      const proposal = yield* Schema.decodeUnknown(CardProposalSchema)({
        ...command.proposal,
        front: match.card.cloze?.text ?? match.card.front,
        back: match.card.back,
        objectiveId: match.card.objectiveIds?.[0] ?? null,
      }).pipe(
        Effect.mapError(() =>
          failure(
            "The saved card cannot be represented as a tutor proposal. Its content has been preserved.",
          ),
        ),
      );
      return { workspace, cardId, proposal };
    }
    const content = yield* refinementCardContent(command.proposal, {
      tags: [],
      media: [],
      objectiveIds: [],
    }).pipe(Effect.mapError((error) => failure(error.message)));
    const authored = yield* createStudyCard(
      workspace,
      {
        areaId: command.areaId,
        cardId,
        content,
      },
      now,
    ).pipe(Effect.mapError((error) => failure(error.message)));
    return {
      cardId,
      proposal: {
        ...command.proposal,
        front: command.proposal.front.trim(),
        back: command.proposal.back.trim(),
      },
      workspace: {
        ...authored,
        areas: authored.areas.map((area) => ({
          ...area,
          cards: area.cards.map((card) =>
            card.id === cardId ? { ...card, origin: "ai-generated" as const, sourceId } : card,
          ),
        })),
      },
    };
  });
}

/** Acknowledges approval only after local storage confirms the canonical card is durable. */
export function persistTutorCardApproval(
  store: WorkspaceStore,
  workspaceInput: unknown,
  input: unknown,
  now: Date,
) {
  return Effect.gen(function* () {
    const prepared = yield* prepareTutorCardApproval(workspaceInput, input, now);
    yield* saveWorkspace(store, prepared.workspace).pipe(
      Effect.mapError(() =>
        failure("The card could not be saved locally. Your proposal remains available to retry."),
      ),
    );
    return prepared;
  });
}
