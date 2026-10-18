import { Effect, Schema } from "effect";
import { normalizeReviewTimestamp } from "@recall/contracts";
import {
  KnowledgeAreaSchema,
  ObjectiveIdSchema,
  AssessmentIdSchema,
  ReviewEventSchema,
} from "@recall/domain";
import { CardProposalSchema } from "@recall/ai-core";
import {
  commit,
  failure,
  read,
  validate,
  Time,
  Uuid,
  NotebookConceptSchema,
  StudySourceReferenceSchema,
  hasConceptCycle,
  type KnowledgeNotebook,
  type NotebookFailure,
} from "./knowledge-notebook-schema";
export function appendNotebookReviewEvidence(
  notebookInput: unknown,
  areaInput: unknown,
  eventsInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const area = yield* validate(KnowledgeAreaSchema, areaInput);
    const events = yield* validate(Schema.Array(ReviewEventSchema), eventsInput);
    if (area.id !== notebook.areaId)
      return yield* Effect.fail(
        failure("invalid-input", "Review evidence belongs to another area."),
      );
    let evidence = notebook.evidence;
    for (const event of events) {
      if (event.areaId !== notebook.areaId) continue;
      const card = area.cards.find((item) => item.id === event.cardId);
      if (!card) continue;
      const normalizedTime = normalizeReviewTimestamp(event.effectiveReviewedAt ?? event.ratedAt);
      const at = normalizedTime === null ? Number.NaN : Date.parse(normalizedTime);
      if (!Number.isSafeInteger(at) || at < 0)
        return yield* Effect.fail(failure("invalid-input", "The review evidence time is invalid."));
      for (const conceptId of [
        ...new Set([
          ...card.objectiveIds,
          ...notebook.proposals
            .filter((proposal) => proposal.status === "accepted" && proposal.cardId === card.id)
            .map((proposal) => proposal.conceptId),
          ...notebook.evidence
            .filter((entry) => entry.linkedCardIds.includes(card.id))
            .map((entry) => entry.conceptId),
        ]),
      ]) {
        if (!notebook.concepts.some((concept) => concept.id === conceptId)) continue;
        const id = `review:${event.id}:${conceptId}`;
        if (evidence.some((entry) => entry.id === id)) continue;
        evidence = [
          ...evidence,
          { kind: "review", id, conceptId, reviewEvent: event, at, linkedCardIds: [card.id] },
        ];
      }
    }
    return yield* commit({ ...notebook, evidence });
  });
}
const normalized = (text: string) =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
export function addNotebookProposal(
  notebookInput: unknown,
  input: unknown,
  existingCardsInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(
      Schema.Struct({
        id: Uuid,
        conceptId: ObjectiveIdSchema,
        evidenceIds: Schema.Array(Schema.String),
        chatMessageId: Schema.optional(Uuid),
        sourceReferences: Schema.optional(
          Schema.Array(StudySourceReferenceSchema).pipe(Schema.minItems(1), Schema.maxItems(20)),
        ),
        aiRefinementOf: Schema.optional(Uuid),
        claimId: Schema.optional(Uuid),
        proposal: CardProposalSchema,
        createdAt: Time,
        providerSessionId: Schema.optional(Uuid),
        providerResolutionRequired: Schema.optional(Schema.Boolean),
      }),
      input,
    );
    const cards = yield* validate(
      Schema.Array(
        Schema.Struct({
          front: Schema.optional(Schema.String),
          back: Schema.optional(Schema.String),
          text: Schema.optional(Schema.String),
        }),
      ),
      existingCardsInput,
    );
    if (notebook.proposals.some((proposal) => proposal.id === value.id))
      return yield* Effect.fail(
        failure("proposal-conflict", "This card proposal is already recorded."),
      );
    const duplicate = (front: string, back: string) =>
      normalized(front) === normalized(value.proposal.front) &&
      normalized(back) === normalized(value.proposal.back);
    if (
      cards.some(
        (card) =>
          card.front !== undefined && card.back !== undefined && duplicate(card.front, card.back),
      ) ||
      notebook.proposals.some(
        (proposal) =>
          proposal.status !== "discarded" &&
          duplicate(proposal.proposal.front, proposal.proposal.back),
      )
    )
      return yield* Effect.fail(
        failure(
          "duplicate-card",
          "An equivalent card or pending proposal already exists. Review that card instead.",
        ),
      );
    return yield* commit({
      ...notebook,
      proposals: [
        ...notebook.proposals,
        { ...value, status: "pending", providerAcknowledged: false, cardId: null },
      ],
    });
  });
}
export function resolveNotebookProposal(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(
      Schema.Struct({
        id: Uuid,
        status: Schema.Literal("accepted", "discarded"),
        cardId: Schema.optional(AssessmentIdSchema),
        proposal: Schema.optional(CardProposalSchema),
      }),
      input,
    );
    const proposal = notebook.proposals.find((item) => item.id === value.id);
    const cardId = value.status === "accepted" ? (value.cardId ?? null) : null;
    if (!proposal || (value.status === "accepted" && cardId === null))
      return yield* Effect.fail(
        failure(
          "proposal-conflict",
          "Approve and durably save a card before linking it to the notebook.",
        ),
      );
    if (proposal.status !== "pending") {
      if (
        proposal.status === value.status &&
        proposal.cardId === cardId &&
        (value.proposal === undefined ||
          JSON.stringify(value.proposal) === JSON.stringify(proposal.proposal))
      )
        return notebook;
      return yield* Effect.fail(
        failure("proposal-conflict", "This proposal was already resolved differently."),
      );
    }
    return yield* commit({
      ...notebook,
      proposals: notebook.proposals.map((item) =>
        item.id === value.id
          ? {
              ...item,
              proposal: value.proposal ?? item.proposal,
              status: value.status,
              cardId,
              providerAcknowledged: false,
            }
          : item,
      ),
      evidence: notebook.evidence.map((entry) =>
        cardId !== null && proposal.evidenceIds.includes(entry.id)
          ? { ...entry, linkedCardIds: [...new Set([...entry.linkedCardIds, cardId])] }
          : entry,
      ),
    });
  });
}

/** Concepts are added only after learner approval; retries with the same contents are safe. */
export function addNotebookConcepts(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const concepts = yield* validate(
      Schema.Array(NotebookConceptSchema).pipe(Schema.minItems(1), Schema.maxItems(200)),
      input,
    );
    let next = notebook.concepts;
    for (const concept of concepts) {
      const existing = next.find((item) => item.id === concept.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(concept))
          return yield* Effect.fail(
            failure("invalid-input", "This concept identity already has different content."),
          );
      } else next = [...next, concept];
    }
    if (hasConceptCycle(next))
      return yield* Effect.fail(
        failure("invalid-input", "Concept hierarchy and prerequisites cannot contain cycles."),
      );
    return yield* commit({ ...notebook, concepts: next });
  });
}
export function markNotebookProposalAcknowledged(
  notebookInput: unknown,
  idInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const id = yield* validate(Uuid, idInput);
    const proposal = notebook.proposals.find((item) => item.id === id);
    if (!proposal || proposal.status === "pending")
      return yield* Effect.fail(
        failure(
          "proposal-conflict",
          "Resolve the proposal before recording provider acknowledgment.",
        ),
      );
    return yield* commit({
      ...notebook,
      proposals: notebook.proposals.map((item) =>
        item.id === id ? { ...item, providerAcknowledged: true } : item,
      ),
    });
  });
}

/** Save validated pending edits explicitly; approved card content remains immutable. */
export function editNotebookProposal(
  notebookInput: unknown,
  input: unknown,
  existingCardsInput: unknown = [],
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(Schema.Struct({ id: Uuid, proposal: CardProposalSchema }), input);
    const existing = notebook.proposals.find((proposal) => proposal.id === value.id);
    if (!existing || existing.status !== "pending")
      return yield* Effect.fail(
        failure("proposal-conflict", "Only pending proposals can be edited."),
      );
    const withoutProposal = {
      ...notebook,
      proposals: notebook.proposals.filter((proposal) => proposal.id !== value.id),
    };
    yield* addNotebookProposal(
      withoutProposal,
      { ...existing, proposal: value.proposal },
      existingCardsInput,
    );
    return yield* commit({
      ...notebook,
      proposals: notebook.proposals.map((proposal) =>
        proposal.id === value.id ? { ...proposal, proposal: value.proposal } : proposal,
      ),
    });
  });
}
