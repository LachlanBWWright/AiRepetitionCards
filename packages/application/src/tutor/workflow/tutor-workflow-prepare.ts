import { Effect, Either, Schema } from "effect";
import {
  TutorContextSchema,
  TutorSessionStateSchema,
  ResolveProposalRequestSchema,
  cardIdForTutorProposal,
  decodeTutorActionRequest,
  decodeTutorContext,
  selectTutorContextHistory,
  selectTutorInferenceContext,
  type TutorActionRequest,
} from "@recall/ai-core";

const SnapshotSchema = Schema.Struct({
  context: TutorContextSchema,
  state: TutorSessionStateSchema,
  pendingQuestion: Schema.Boolean,
});
export type TutorWorkflowSnapshot = typeof SnapshotSchema.Type;
export type TutorWorkflowFailure = {
  readonly _tag: "TutorWorkflowFailure";
  readonly code:
    | "invalid-request"
    | "invalid-session"
    | "session-not-found"
    | "session-area-mismatch"
    | "unknown-objective"
    | "question-required"
    | "quiz-not-found"
    | "quiz-question-not-found"
    | "quiz-answer-already-evaluated"
    | "observation-not-found"
    | "proposal-not-recommended"
    | "proposal-not-found"
    | "invalid-provider-response"
    | "context-budget-exceeded"
    | "unsupported-operation"
    | "structured-output-unsupported"
    | "invalid-provider-capabilities"
    | "output-budget-exceeded";
};
export const tutorWorkflowFailure = (code: TutorWorkflowFailure["code"]): TutorWorkflowFailure => ({
  _tag: "TutorWorkflowFailure",
  code,
});

export type PreparedTutorWorkflow = {
  readonly action: TutorActionRequest;
  readonly snapshot: TutorWorkflowSnapshot;
  readonly createsSession: boolean;
};

/** Validate session eligibility before reserving quota or invoking a provider. */
export function prepareTutorWorkflow(
  input: unknown,
  snapshotInput: unknown,
  newSessionId: string,
): Effect.Effect<PreparedTutorWorkflow, TutorWorkflowFailure> {
  const failure = tutorWorkflowFailure;
  return Effect.gen(function* () {
    const action = yield* decodeTutorActionRequest(input).pipe(
      Effect.mapError(() => failure("invalid-request")),
    );
    const suppliedContext = "context" in action ? action.context : undefined;
    if (action.sessionId && snapshotInput === null)
      return yield* Effect.fail(failure("session-not-found"));
    if (!action.sessionId && !suppliedContext)
      return yield* Effect.fail(failure("session-not-found"));
    const decoded = Schema.decodeUnknownEither(SnapshotSchema)(
      snapshotInput ?? {
        context: suppliedContext,
        pendingQuestion: false,
        state: {
          sessionId: newSessionId,
          history: suppliedContext?.history ?? [],
          evaluation: null,
          observations: [],
          proposal: null,
          quiz: null,
        },
      },
    );
    if (Either.isLeft(decoded)) return yield* Effect.fail(failure("invalid-session"));
    const snapshot = decoded.right;
    if (action.sessionId && snapshot.state.sessionId !== action.sessionId)
      return yield* Effect.fail(failure("invalid-session"));
    if (suppliedContext && suppliedContext.knowledgeArea.id !== snapshot.context.knowledgeArea.id)
      return yield* Effect.fail(failure("session-area-mismatch"));
    const context = yield* decodeTutorContext({
      ...snapshot.context,
      history: selectTutorContextHistory(snapshot.state.history, snapshot.context.ephemeralSession),
    }).pipe(Effect.mapError(() => failure("invalid-session")));
    if (
      action.action === "targeted-quiz" &&
      !context.knowledgeArea.objectives.some((item) => item.id === action.objectiveId)
    )
      return yield* Effect.fail(failure("unknown-objective"));
    if (
      action.action === "study-card" &&
      action.material.objectiveId !== null &&
      !context.knowledgeArea.objectives.some((item) => item.id === action.material.objectiveId)
    )
      return yield* Effect.fail(failure("unknown-objective"));
    const assistanceObjective =
      action.action === "refine-card"
        ? action.refinement.objectiveId
        : action.action === "inspect-card"
          ? action.inspection.objectiveId
          : null;
    if (
      assistanceObjective !== null &&
      !context.knowledgeArea.objectives.some((item) => item.id === assistanceObjective)
    )
      return yield* Effect.fail(failure("unknown-objective"));
    if (action.action === "evaluate" && (!snapshot.pendingQuestion || snapshot.state.quiz))
      return yield* Effect.fail(failure("question-required"));
    if (action.action === "evaluate-quiz-answer") {
      if (!snapshot.state.quiz) return yield* Effect.fail(failure("quiz-not-found"));
      const question = snapshot.state.quiz.questions[action.questionIndex];
      if (!question) return yield* Effect.fail(failure("quiz-question-not-found"));
      if (question.evaluation) return yield* Effect.fail(failure("quiz-answer-already-evaluated"));
    }
    if (action.action === "propose-card") {
      if (!snapshot.state.evaluation) return yield* Effect.fail(failure("observation-not-found"));
      if (snapshot.state.evaluation.suggestedAction !== "propose-card")
        return yield* Effect.fail(failure("proposal-not-recommended"));
    }
    yield* selectTutorInferenceContext(
      {
        ...context,
        ...("material" in action ? { material: action.material } : {}),
        ...("refinement" in action ? { refinement: action.refinement } : {}),
        ...("inspection" in action ? { inspection: action.inspection } : {}),
        ...("answer" in action ? { answer: action.answer } : {}),
        ...(snapshot.state.evaluation ? { observation: snapshot.state.evaluation } : {}),
      },
      undefined,
      action.action === "targeted-quiz" ? action.objectiveId : snapshot.state.quiz?.objectiveId,
    ).pipe(Effect.mapError(() => failure("context-budget-exceeded")));
    return {
      action,
      snapshot: { ...snapshot, context },
      createsSession: !action.sessionId,
    };
  });
}

/** Validate resolution intent before the adapter's atomic pending-state update. */
export function validateTutorProposalResolution(input: unknown) {
  return Schema.decodeUnknown(ResolveProposalRequestSchema)(input).pipe(
    Effect.mapError(() => tutorWorkflowFailure("invalid-request")),
    Effect.flatMap((request) =>
      request.state === "approved" && request.cardId !== cardIdForTutorProposal(request.proposalId)
        ? Effect.fail(tutorWorkflowFailure("invalid-request"))
        : Effect.succeed(request),
    ),
  );
}

/** Local persistence applies the same pending-proposal transition as the hosted RPC. */
export function resolveTutorWorkflowProposal(
  snapshot: TutorWorkflowSnapshot,
  input: unknown,
): Effect.Effect<TutorWorkflowSnapshot, TutorWorkflowFailure> {
  return Effect.gen(function* () {
    const request = yield* validateTutorProposalResolution(input);
    if (snapshot.state.proposal?.proposalId !== request.proposalId)
      return yield* Effect.fail(tutorWorkflowFailure("proposal-not-found"));
    if (
      request.content?.objectiveId != null &&
      !snapshot.context.knowledgeArea.objectives.some(
        (item) => item.id === request.content?.objectiveId,
      )
    )
      return yield* Effect.fail(tutorWorkflowFailure("unknown-objective"));
    return { ...snapshot, state: { ...snapshot.state, proposal: null } };
  });
}
