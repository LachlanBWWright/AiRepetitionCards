import { Effect, Schema } from "effect";
import { KnowledgeAreaSchema, ObjectiveIdSchema } from "@recall/domain";
import { AnswerEvaluationSchema, TutorQuestionSchema } from "@recall/ai-core";
import {
  commit,
  failure,
  read,
  validate,
  Time,
  Uuid,
  NotebookModeSchema,
  type KnowledgeNotebook,
  type NotebookFailure,
  type NotebookMode,
  type NotebookConcept,
} from "./knowledge-notebook-schema";
import { deriveNotebookAssessmentValues } from "./knowledge-notebook-assessments";
export function seedKnowledgeNotebook(
  areaInput: unknown,
  goalInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const area = yield* validate(KnowledgeAreaSchema, areaInput);
    const goal = yield* validate(
      Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
      goalInput,
    );
    return yield* commit({
      version: 1,
      areaId: area.id,
      goal,
      concepts: area.objectives.length
        ? area.objectives.map((objective) => ({
            ...objective,
            objectiveId: objective.id,
            parentId: null,
          }))
        : [
            {
              id: yield* validate(ObjectiveIdSchema, area.id),
              title: area.title,
              description: area.description,
              parentId: null,
              objectiveId: null,
              prerequisiteIds: [],
            },
          ],
      evidence: [],
      proposals: [],
      session: {
        phase: "idle",
        targetConceptId: null,
        pendingQuestion: null,
        draftAnswer: "",
        draftConfidence: "unsure",
        mode: "diagnostic",
        askedQuestions: 0,

        requestsUsed: 0,
        startedAt: null,

        skippedConceptIds: [],
      },
    });
  });
}
/** Change future tutoring context without discarding the current question or saved work. */
export function updateNotebookGoal(
  notebookInput: unknown,
  goalInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const text = yield* validate(Schema.String, goalInput);
    const goal = yield* validate(
      Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
      text.trim(),
    );
    return yield* commit({ ...notebook, goal });
  });
}

export function beginNotebookSession(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const settings = yield* validate(
      Schema.Struct({
        startedAt: Time,
      }),
      input,
    );
    if (notebook.session.phase === "active")
      return yield* Effect.fail(
        failure(
          "pending-question",
          "Resume or finish the current investigation before starting another.",
        ),
      );
    return yield* commit({
      ...notebook,
      session: {
        ...notebook.session,
        ...settings,
        phase: "active",
        targetConceptId: null,
        pendingQuestion: null,
        mode: "diagnostic",
        draftAnswer: "",
        draftConfidence: "unsure",
        askedQuestions: 0,
        requestsUsed: 0,
        skippedConceptIds: [],
      },
    });
  });
}
/** Save unfinished learner input without creating assessment evidence or spending AI usage. */
export function updateNotebookAnswerDraft(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const draft = yield* validate(
      Schema.Struct({
        answer: Schema.String.pipe(Schema.maxLength(8000)),
        learnerConfidence: Schema.Literal("guess", "unsure", "confident"),
      }),
      input,
    );
    if (!notebook.session.pendingQuestion)
      return yield* Effect.fail(
        failure("missing-question", "Ask a question before saving an answer draft."),
      );
    return yield* commit({
      ...notebook,
      session: {
        ...notebook.session,
        draftAnswer: draft.answer,
        draftConfidence: draft.learnerConfidence,
      },
    });
  });
}

export function reserveNotebookRequest(
  notebookInput: unknown,
  nowInput: unknown,
  task: "question" | "evaluate" | "propose-card" = "question",
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    yield* validate(Time, nowInput);
    if (
      notebook.session.phase !== "active" &&
      !(task === "propose-card" && notebook.session.phase === "finished")
    )
      return yield* Effect.fail(
        failure("session-inactive", "Start or resume an investigation first."),
      );
    if (task === "evaluate" && notebook.session.pendingQuestion === null)
      return yield* Effect.fail(
        failure("missing-question", "There is no pending question to evaluate."),
      );
    return yield* commit({
      ...notebook,
      session: { ...notebook.session, requestsUsed: notebook.session.requestsUsed + 1 },
    });
  });
}
export const admitNotebookRequest = reserveNotebookRequest;
export type NotebookTarget = {
  readonly conceptId: NotebookConcept["id"];
  readonly mode: NotebookMode;
  readonly reason: string;
};
export function selectNotebookTarget(
  notebookInput: unknown,
  nowInput: unknown,
): Effect.Effect<NotebookTarget | null, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    yield* validate(Time, nowInput);
    if (notebook.session.phase !== "active") return null;
    if (notebook.session.pendingQuestion && notebook.session.targetConceptId !== null)
      return {
        conceptId: notebook.session.targetConceptId,
        mode: notebook.session.mode,
        reason: "Resume the unanswered question.",
      };
    const available = deriveNotebookAssessmentValues(notebook).filter(
      (item) => !notebook.session.skippedConceptIds.includes(item.conceptId),
    );
    const gap = available.find((item) => item.status === "needs-reinforcement");
    if (gap) {
      const concept = notebook.concepts.find((item) => item.id === gap.conceptId);
      const prerequisite = concept?.prerequisiteIds.find((id) =>
        available.some((item) => item.conceptId === id && item.status !== "demonstrated"),
      );
      if (prerequisite)
        return {
          conceptId: prerequisite,
          mode: "clarify",
          reason: "Check a prerequisite implicated by a gap.",
        };
    }
    const target = notebook.session.targetConceptId;
    if (
      target &&
      notebook.session.mode !== "diagnostic" &&
      !notebook.session.skippedConceptIds.includes(target)
    )
      return {
        conceptId: target,
        mode: notebook.session.mode,
        reason: "Continue the deliberate follow-up.",
      };
    const next =
      available.find((item) => item.status === "unassessed") ??
      gap ??
      available.find((item) => item.status === "uncertain");
    return next
      ? {
          conceptId: next.conceptId,
          mode: next.status === "unassessed" ? "diagnostic" : "revisit",
          reason: next.reason,
        }
      : null;
  });
}
export function setNotebookQuestion(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(
      Schema.Struct({
        question: TutorQuestionSchema,
        conceptId: Schema.optional(ObjectiveIdSchema),
        mode: Schema.optional(NotebookModeSchema),
        now: Time,
        providerSessionId: Schema.optional(Uuid),
      }),
      input,
    );
    if (notebook.session.phase !== "active")
      return yield* Effect.fail(failure("session-inactive", "This investigation is not active."));
    if (notebook.session.pendingQuestion && notebook.session.targetConceptId !== null)
      return yield* Effect.fail(
        failure("pending-question", "Answer or skip the existing question before replacing it."),
      );
    const conceptId =
      value.conceptId ?? (yield* validate(ObjectiveIdSchema, value.question.objectiveId));
    if (
      value.question.objectiveId !==
      (notebook.concepts.find((concept) => concept.id === conceptId)?.objectiveId ?? null)
    )
      return yield* Effect.fail(
        failure("invalid-input", "The question belongs to another concept."),
      );
    return yield* commit({
      ...notebook,
      session: {
        ...notebook.session,
        ...(value.providerSessionId === undefined
          ? {}
          : { providerSessionId: value.providerSessionId }),
        targetConceptId: conceptId,
        mode: value.mode ?? notebook.session.mode,
        pendingQuestion: value.question,
        draftAnswer: "",
        draftConfidence: "unsure",
        askedQuestions: notebook.session.askedQuestions + 1,
      },
    });
  });
}
export function appendNotebookAnswer(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(
      Schema.Struct({
        id: Uuid,
        answer: Schema.String.pipe(Schema.maxLength(8000)),
        learnerConfidence: Schema.Literal("guess", "unsure", "confident"),
        evaluation: AnswerEvaluationSchema,
        at: Time,
        providerSessionId: Schema.optional(Uuid),
      }),
      input,
    );
    const question = notebook.session.pendingQuestion;
    if (!question)
      return yield* Effect.fail(
        failure("missing-question", "There is no pending question to evaluate."),
      );
    if (notebook.evidence.some((entry) => entry.id === value.id))
      return yield* Effect.fail(
        failure("duplicate-evidence", "This observation has already been recorded."),
      );
    const conceptId = notebook.session.targetConceptId;
    if (conceptId === null)
      return yield* Effect.fail(
        failure("missing-question", "The pending question has no concept."),
      );
    if (value.evaluation.objectiveId !== question.objectiveId)
      return yield* Effect.fail(
        failure("invalid-input", "The evaluation belongs to another concept."),
      );
    const modes: readonly NotebookMode[] = [
      "diagnostic",
      "clarify",
      "predict",
      "vary",
      "explain",
      "apply",
      "revisit",
    ];
    const mode =
      value.evaluation.result === "incorrect" || value.evaluation.result === "partial"
        ? "clarify"
        : notebook.session.mode === "diagnostic" ||
            notebook.session.mode === "apply" ||
            notebook.session.mode === "revisit"
          ? "diagnostic"
          : (modes[Math.min(modes.indexOf(notebook.session.mode) + 1, modes.length - 1)] ??
            "revisit");
    return yield* commit({
      ...notebook,
      evidence: [
        ...notebook.evidence,
        {
          ...value,
          kind: "tutor",
          conceptId,
          question: question.question,
          investigationMode: notebook.session.mode,
          linkedCardIds: [],
        },
      ],
      session: {
        ...notebook.session,
        pendingQuestion: null,
        draftAnswer: "",
        draftConfidence: "unsure",
        mode,
        targetConceptId: conceptId,
      },
    });
  });
}
export function controlNotebookSession(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(
      Schema.Struct({ action: Schema.Literal("deeper", "explain", "skip", "finish"), now: Time }),
      input,
    );
    if (notebook.session.phase !== "active")
      return yield* Effect.fail(failure("session-inactive", "This investigation is not active."));
    const target = notebook.session.targetConceptId;
    return yield* commit({
      ...notebook,
      session: {
        ...notebook.session,
        phase: value.action === "finish" ? "finished" : "active",
        pendingQuestion: null,
        draftAnswer: "",
        draftConfidence: "unsure",
        targetConceptId: value.action === "skip" || value.action === "finish" ? null : target,
        mode:
          value.action === "deeper"
            ? "apply"
            : value.action === "explain"
              ? "explain"
              : "diagnostic",
        skippedConceptIds:
          value.action === "skip" && target !== null
            ? [...new Set([...notebook.session.skippedConceptIds, target])]
            : notebook.session.skippedConceptIds,
      },
    });
  });
}
