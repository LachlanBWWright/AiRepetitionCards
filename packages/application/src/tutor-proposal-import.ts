import { Effect, Schema } from "effect";
import { AnswerEvaluationSchema, CardProposalSchema } from "@recall/ai-core";
import { KnowledgeAreaSchema, ObjectiveIdSchema } from "@recall/domain";
import {
  KnowledgeNotebookSchema,
  NotebookConceptSchema,
  seedKnowledgeNotebook,
  addNotebookProposal,
  type NotebookFailure,
} from "./knowledge-notebook";
const fail = (message: string): NotebookFailure => ({
  _tag: "NotebookFailure",
  reason: "proposal-conflict",
  message,
});
/** Transfer recorded provider evidence, never infer mastery from generated card content. */
export function importTutorProposal(
  notebookInput: unknown,
  areaInput: unknown,
  input: unknown,
  existingCards: unknown = [],
) {
  return Effect.gen(function* () {
    const area = yield* Schema.decodeUnknown(KnowledgeAreaSchema)(areaInput).pipe(
      Effect.mapError(() => fail("The learning area could not be validated.")),
    );
    const value = yield* Schema.decodeUnknown(
      Schema.Struct({
        proposalId: Schema.UUID,
        sessionId: Schema.UUID,
        proposal: CardProposalSchema,
        evaluation: AnswerEvaluationSchema,
        question: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
        answer: Schema.String.pipe(Schema.maxLength(8000)),
        evidenceId: Schema.UUID,
        now: Schema.Number.pipe(
          Schema.int(),
          Schema.nonNegative(),
          Schema.filter(Number.isSafeInteger),
          Schema.lessThanOrEqualTo(8_640_000_000_000_000),
        ),
      }),
    )(input).pipe(
      Effect.mapError(() =>
        fail("Transfer the original question, answer, evaluation and provider identities."),
      ),
    );
    let notebook =
      notebookInput === null
        ? yield* seedKnowledgeNotebook(area, `Study ${area.title}`.slice(0, 2000))
        : yield* Schema.decodeUnknown(KnowledgeNotebookSchema)(notebookInput).pipe(
            Effect.mapError(() => fail("The saved notebook could not be validated.")),
          );
    if (
      notebook.areaId !== area.id ||
      value.evaluation.objectiveId !== value.proposal.objectiveId ||
      (value.proposal.objectiveId !== null &&
        !area.objectives.some((objective) => objective.id === value.proposal.objectiveId))
    )
      return yield* Effect.fail(
        fail(
          "The proposal and its recorded evaluation must belong to this learning area and objective.",
        ),
      );
    const previous = notebook.proposals.find((proposal) => proposal.id === value.proposalId);
    if (previous) {
      if (
        previous.providerSessionId !== value.sessionId ||
        JSON.stringify(previous.proposal) !== JSON.stringify(value.proposal)
      )
        return yield* Effect.fail(
          fail("This proposal was already transferred with different content."),
        );
      return notebook;
    }
    if (notebook.evidence.some((evidence) => evidence.id === value.evidenceId))
      return yield* Effect.fail(fail("Choose a fresh identity for the imported observation."));
    let concept = notebook.concepts.find((item) => item.objectiveId === value.proposal.objectiveId);
    if (!concept) {
      const objective = area.objectives.find((item) => item.id === value.proposal.objectiveId);
      const conceptId = yield* Schema.decodeUnknown(ObjectiveIdSchema)(
        objective?.id ?? area.id,
      ).pipe(
        Effect.mapError(() => fail("The imported observation has no valid concept identity.")),
      );
      if (notebook.concepts.some((item) => item.id === conceptId))
        return yield* Effect.fail(
          fail("This concept identity is already bound to another objective."),
        );
      concept = yield* Schema.decodeUnknown(NotebookConceptSchema)({
        id: conceptId,
        title: objective?.title ?? area.title,
        description: objective?.description ?? area.description,
        objectiveId: value.proposal.objectiveId,
        parentId: null,
        prerequisiteIds: [],
      }).pipe(Effect.mapError(() => fail("The imported observation concept is invalid.")));
      notebook = { ...notebook, concepts: [...notebook.concepts, concept] };
    }
    const recorded = yield* Schema.decodeUnknown(KnowledgeNotebookSchema)({
      ...notebook,
      evidence: [
        ...notebook.evidence,
        {
          kind: "tutor",
          id: value.evidenceId,
          conceptId: concept.id,
          question: value.question,
          answer: value.answer,
          // Legacy quizzes did not collect self-confidence; unsure preserves uncertainty.
          learnerConfidence: "unsure",
          evaluation: value.evaluation,
          at: value.now,
          providerSessionId: value.sessionId,
          linkedCardIds: [],
        },
      ],
    }).pipe(
      Effect.mapError(() =>
        fail(
          "The recorded observation could not be appended without changing existing notebook evidence.",
        ),
      ),
    );
    return yield* addNotebookProposal(
      recorded,
      {
        id: value.proposalId,
        conceptId: concept.id,
        evidenceIds: [value.evidenceId],
        proposal: value.proposal,
        createdAt: value.now,
        providerSessionId: value.sessionId,
      },
      existingCards,
    );
  });
}
