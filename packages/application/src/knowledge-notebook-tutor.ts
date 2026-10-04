import { Effect, Schema } from "effect";
import {
  TutorActionResponseSchema,
  TutorContextSchema,
  TutorSessionStateSchema,
  selectTutorContextHistory,
  type TutorHistoryMessage,
} from "@recall/ai-core";
import { createTutorApi, tutorApiFailureMessage, type TutorApiFailure } from "./tutor-api";
import {
  KnowledgeNotebookSchema,
  addNotebookProposal,
  appendNotebookAnswer,
  deriveNotebookAssessments,
  reserveNotebookRequest,
  selectNotebookTarget,
  setNotebookQuestion,
  type KnowledgeNotebook,
} from "./knowledge-notebook";

export type NotebookTutorFailure = {
  readonly _tag: "NotebookTutorFailure";
  readonly message: string;
  /** Keep this state on failure: admitted attempts and completed evidence must not be lost. */
  readonly notebook: KnowledgeNotebook | null;
  readonly providerFailure?: TutorApiFailure;
};
const failure = (message: string, notebook: KnowledgeNotebook | null): NotebookTutorFailure => ({
  _tag: "NotebookTutorFailure",
  message,
  notebook,
});
const AnswerInput = Schema.Struct({
  evidenceId: Schema.UUID,
  answer: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(8000)),
  learnerConfidence: Schema.Literal("guess", "unsure", "confident"),
});
const ExistingCards = Schema.Array(
  Schema.Struct({
    front: Schema.optional(Schema.String),
    back: Schema.optional(Schema.String),
    text: Schema.optional(Schema.String),
  }),
);

/** Encode recorded content as data, with explicit truncation rather than interpreting instructions. */
function evidenceMessage(
  role: TutorHistoryMessage["role"],
  fields: Readonly<Record<string, string | number | null>>,
): TutorHistoryMessage {
  let limit = 6000;
  let content = "";
  do {
    const data = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        typeof value === "string" ? value.slice(0, limit) : value,
      ]),
    );
    content = JSON.stringify({
      untrustedRecordedLearningData: data,
      truncated: Object.values(fields).some(
        (value) => typeof value === "string" && value.length > limit,
      ),
    });
    limit = Math.floor(limit / 2);
  } while (content.length > 8000 && limit > 0);
  return { role, content };
}

function investigationHistory(
  notebook: KnowledgeNotebook,
  conceptId: string,
): readonly TutorHistoryMessage[] {
  const concept = notebook.concepts.find((item) => item.id === conceptId);
  const prerequisites = new Set(concept?.prerequisiteIds ?? []);
  const chronological = [...notebook.evidence].sort(
    (left, right) => left.at - right.at || left.id.localeCompare(right.id),
  );
  // Selected-concept records follow prerequisite context so the bounded window retains its newest evidence.
  const related = [
    ...chronological.filter((entry) => prerequisites.has(entry.conceptId)).slice(-4),
    ...chronological.filter((entry) => entry.conceptId === conceptId).slice(-6),
  ];
  return related.flatMap((entry): readonly TutorHistoryMessage[] => {
    const title = notebook.concepts.find((item) => item.id === entry.conceptId)?.title ?? "";
    const shared = { conceptId: entry.conceptId, conceptTitle: title, recordedAt: entry.at };
    if (entry.kind === "review")
      return [
        evidenceMessage("assistant", {
          ...shared,
          recordKind: "recorded-review",
          rating: entry.reviewEvent.rating,
        }),
      ];
    return [
      evidenceMessage("assistant", {
        ...shared,
        recordKind: "recorded-question",
        question: entry.question,
      }),
      evidenceMessage("learner", {
        ...shared,
        recordKind: "recorded-answer",
        answer: entry.answer,
        learnerConfidence: entry.learnerConfidence,
      }),
      evidenceMessage("assistant", {
        ...shared,
        recordKind: "recorded-evaluation",
        result: entry.evaluation.result,
        confidence: entry.evaluation.confidence,
        feedback: entry.evaluation.feedback,
        misconception: entry.evaluation.misconception,
        suggestedAction: entry.evaluation.suggestedAction,
      }),
    ];
  });
}

/** Portable harness over existing tutor actions; no provider or runtime dependencies. */
export function createKnowledgeNotebookTutor(
  api: Pick<ReturnType<typeof createTutorApi>, "request"> &
    Partial<Pick<ReturnType<typeof createTutorApi>, "readSession">>,
  persistBeforeRequest: (
    notebook: KnowledgeNotebook,
  ) => Effect.Effect<void, { readonly message: string }>,
) {
  const read = (input: unknown) =>
    Schema.decodeUnknown(KnowledgeNotebookSchema)(input).pipe(
      Effect.mapError(() =>
        failure(
          "The saved investigation could not be validated. Preserve it before recovery.",
          null,
        ),
      ),
    );
  const preserve = (notebook: KnowledgeNotebook) =>
    persistBeforeRequest(notebook).pipe(
      Effect.mapError((error) => failure(error.message, notebook)),
      Effect.as(notebook),
    );
  const reserve = (
    notebook: KnowledgeNotebook,
    now: number,
    task: "question" | "evaluate" | "propose-card",
  ) =>
    reserveNotebookRequest(notebook, now, task).pipe(
      Effect.mapError((error) => failure(error.message, notebook)),
      Effect.flatMap(preserve),
    );
  const request = (notebook: KnowledgeNotebook, input: Parameters<typeof api.request>[0]) =>
    api.request(input).pipe(
      Effect.catchAll((original) =>
        Effect.gen(function* () {
          if (!api.readSession || (input.action !== "evaluate" && input.action !== "propose-card"))
            return yield* Effect.fail(original);
          // A response can be lost after the provider session is committed. Recover only
          // matching, validated evidence; this read performs no new model inference.
          const raw = yield* Effect.either(api.readSession(input.sessionId));
          if (raw._tag === "Left" || raw.right === null) return yield* Effect.fail(original);
          const decoded = yield* Effect.either(
            Schema.decodeUnknown(TutorSessionStateSchema)(raw.right),
          );
          if (decoded._tag === "Left" || decoded.right.sessionId !== input.sessionId)
            return yield* Effect.fail(original);
          const state = decoded.right;
          if (input.action === "evaluate") {
            const question = state.history.at(-3);
            const answer = state.history.at(-2);
            if (
              !state.evaluation ||
              state.evaluation.objectiveId !== notebook.session.pendingQuestion?.objectiveId ||
              question?.role !== "assistant" ||
              question.content !== notebook.session.pendingQuestion.question ||
              answer?.role !== "learner" ||
              answer.content !== input.answer
            )
              return yield* Effect.fail(original);
            return {
              action: "evaluate" as const,
              sessionId: input.sessionId,
              result: state.evaluation,
            };
          }
          const evidence = notebook.evidence.find(
            (entry) => entry.kind === "tutor" && entry.providerSessionId === input.sessionId,
          );
          if (
            !state.proposal ||
            evidence?.kind !== "tutor" ||
            JSON.stringify(state.evaluation) !== JSON.stringify(evidence.evaluation)
          )
            return yield* Effect.fail(original);
          return {
            action: "propose-card" as const,
            sessionId: input.sessionId,
            proposalId: state.proposal.proposalId,
            result: state.proposal.content,
          };
        }),
      ),
      Effect.mapError((providerFailure) => ({
        ...failure(tutorApiFailureMessage(providerFailure), notebook),
        providerFailure,
      })),
      Effect.flatMap((response) =>
        Schema.decodeUnknown(TutorActionResponseSchema)(response).pipe(
          Effect.mapError(() => failure("The tutor response could not be validated.", notebook)),
        ),
      ),
    );
  const ask = (
    notebookInput: unknown,
    contextInput: unknown,
    now: number,
  ): Effect.Effect<KnowledgeNotebook, NotebookTutorFailure> =>
    Effect.gen(function* () {
      const notebook = yield* read(notebookInput);
      if (notebook.session.pendingQuestion)
        return yield* Effect.fail(failure("Answer or skip the current question first.", notebook));
      const context = yield* Schema.decodeUnknown(TutorContextSchema)(contextInput).pipe(
        Effect.mapError(() => failure("The learning context could not be validated.", notebook)),
      );
      if (context.knowledgeArea.id !== notebook.areaId)
        return yield* Effect.fail(
          failure("This investigation belongs to another learning area.", notebook),
        );
      const target = yield* selectNotebookTarget(notebook, now).pipe(
        Effect.mapError((error) => failure(error.message, notebook)),
      );
      if (!target)
        return yield* Effect.fail(
          failure(
            "No further question is available within this investigation's current scope and budget.",
            notebook,
          ),
        );
      const concept = notebook.concepts.find((item) => item.id === target.conceptId);
      if (!concept)
        return yield* Effect.fail(
          failure("The selected concept is no longer available.", notebook),
        );
      const requestedObjectiveId =
        concept.objectiveId === undefined ? concept.id : concept.objectiveId;
      const objectiveId = context.knowledgeArea.objectives.some(
        (item) => item.id === requestedObjectiveId,
      )
        ? requestedObjectiveId
        : null;
      const assessments = yield* deriveNotebookAssessments(notebook).pipe(
        Effect.mapError((error) => failure(error.message, notebook)),
      );
      const uncertainty =
        assessments.find((item) => item.conceptId === concept.id)?.status === "demonstrated"
          ? 0
          : 1;
      const selected = yield* Schema.decodeUnknown(TutorContextSchema)({
        ...context,
        history: selectTutorContextHistory([
          ...context.history,
          ...investigationHistory(notebook, concept.id),
        ]),
        investigation: {
          goal: notebook.goal.slice(0, 2000),
          conceptTitle: concept.title.slice(0, 500),
          conceptDescription: concept.description?.slice(0, 2000) ?? null,
          investigationKind: target.mode,
          reason: target.reason.slice(0, 1000),
          uncertainty,
          uncertaintyBasis:
            "Binary unresolved-understanding flag from recorded observations; not evaluator confidence or a calibrated probability. Recorded evaluations report their own confidence separately.",
          objectiveId,
        },
      }).pipe(
        Effect.mapError(() =>
          failure("The investigation context could not be validated.", notebook),
        ),
      );
      const charged = yield* reserve(notebook, now, "question");
      const response = yield* request(charged, { action: "question", context: selected });
      if (response.action !== "question" || response.result.objectiveId !== objectiveId)
        return yield* Effect.fail(
          failure("The tutor question did not match the selected concept.", charged),
        );
      if (target.mode === "explain" && !response.result.explanation?.trim())
        return yield* Effect.fail(
          failure(
            "The tutor did not provide the requested explanation. Retry Explain first.",
            charged,
          ),
        );
      const question = {
        ...response.result,
        explanation: target.mode === "explain" ? (response.result.explanation ?? null) : null,
      };
      const updated = yield* setNotebookQuestion(charged, {
        question,
        conceptId: target.conceptId,
        mode: target.mode,
        now,
        providerSessionId: response.sessionId,
      }).pipe(Effect.mapError((error) => failure(error.message, charged)));
      return yield* preserve(updated);
    });
  const answer = (
    notebookInput: unknown,
    input: unknown,
    now: number,
  ): Effect.Effect<KnowledgeNotebook, NotebookTutorFailure> =>
    Effect.gen(function* () {
      const notebook = yield* read(notebookInput);
      const value = yield* Schema.decodeUnknown(AnswerInput)(input).pipe(
        Effect.mapError(() =>
          failure("Write an answer and select your confidence before continuing.", notebook),
        ),
      );
      if (!notebook.session.pendingQuestion || !notebook.session.providerSessionId)
        return yield* Effect.fail(
          failure("This question has no resumable tutor session. Ask a new question.", notebook),
        );
      if (notebook.evidence.some((entry) => entry.id === value.evidenceId))
        return yield* Effect.fail(failure("This answer is already recorded.", notebook));
      const sessionId = notebook.session.providerSessionId;
      const charged = yield* reserve(notebook, now, "evaluate");
      const response = yield* request(charged, {
        action: "evaluate",
        sessionId,
        answer: value.answer,
      });
      if (
        response.action !== "evaluate" ||
        response.sessionId !== sessionId ||
        response.result.objectiveId !== notebook.session.pendingQuestion.objectiveId
      )
        return yield* Effect.fail(
          failure("The tutor feedback did not match this question.", charged),
        );
      const updated = yield* appendNotebookAnswer(charged, {
        id: value.evidenceId,
        answer: value.answer,
        learnerConfidence: value.learnerConfidence,
        evaluation: response.result,
        at: now,
        providerSessionId: sessionId,
      }).pipe(Effect.mapError((error) => failure(error.message, charged)));
      return yield* preserve(updated);
    });
  const propose = (
    notebookInput: unknown,
    evidenceId: string,
    existingCardsInput: unknown,
    now: number,
  ): Effect.Effect<KnowledgeNotebook, NotebookTutorFailure> =>
    Effect.gen(function* () {
      const notebook = yield* read(notebookInput);
      const cards = yield* Schema.decodeUnknown(ExistingCards)(existingCardsInput).pipe(
        Effect.mapError(() =>
          failure("The existing card library could not be validated.", notebook),
        ),
      );
      const evidence = notebook.evidence.find((entry) => entry.id === evidenceId);
      if (
        !evidence ||
        evidence.kind !== "tutor" ||
        !evidence.providerSessionId ||
        evidence.evaluation.suggestedAction !== "propose-card"
      )
        return yield* Effect.fail(
          failure("This observation does not support a tutor card proposal.", notebook),
        );
      if (
        notebook.proposals.some(
          (proposal) =>
            proposal.status !== "discarded" && proposal.evidenceIds.includes(evidenceId),
        )
      )
        return yield* Effect.fail(
          failure("This observation already has a card proposal.", notebook),
        );
      const sessionId = evidence.providerSessionId;
      const charged = yield* reserve(notebook, now, "propose-card");
      const response = yield* request(charged, { action: "propose-card", sessionId });
      if (
        response.action !== "propose-card" ||
        response.sessionId !== sessionId ||
        response.result.objectiveId !== evidence.evaluation.objectiveId
      )
        return yield* Effect.fail(
          failure("The card proposal did not match its learning evidence.", charged),
        );
      const updated = yield* addNotebookProposal(
        charged,
        {
          id: response.proposalId,
          conceptId: evidence.conceptId,
          evidenceIds: [evidence.id],
          proposal: response.result,
          createdAt: now,
          providerSessionId: sessionId,
        },
        cards,
      ).pipe(Effect.mapError((error) => failure(error.message, charged)));
      return yield* preserve(updated);
    });
  const proposeBatch = (
    notebookInput: unknown,
    evidenceIdsInput: unknown,
    existingCardsInput: unknown,
    now: number | (() => number),
  ): Effect.Effect<KnowledgeNotebook, NotebookTutorFailure> =>
    Effect.gen(function* () {
      let notebook = yield* read(notebookInput);
      const ids = yield* Schema.decodeUnknown(
        Schema.Array(Schema.String.pipe(Schema.minLength(1))).pipe(Schema.maxItems(100)),
      )(evidenceIdsInput).pipe(
        Effect.mapError(() =>
          failure("Select a bounded group of observations to propose cards from.", notebook),
        ),
      );
      for (const id of new Set(ids))
        notebook = yield* propose(
          notebook,
          id,
          existingCardsInput,
          typeof now === "function" ? now() : now,
        );
      return notebook;
    });
  return { ask, answer, propose, proposeBatch };
}
