import { Effect, Either, Schema } from "effect";
import {
  AnswerEvaluationSchema,
  AiProviderCapabilitiesSchema,
  MAX_TUTOR_INFERENCE_BYTES,
  type AiProviderCapabilities,
  ResolveProposalRequestSchema,
  cardIdForTutorProposal,
  CardProposalSchema,
  MAX_TUTOR_SESSION_OBSERVATIONS,
  TargetedQuizSchema,
  TutorActionResponseSchema,
  TutorContextSchema,
  TutorQuestionSchema,
  TutorSessionStateSchema,
  decodeTutorActionRequest,
  decodeTutorContext,
  selectTutorContextHistory,
  selectTutorInferenceContext,
  type AiContextBudgetExceeded,
  type AnswerEvaluation,
  type TutorActionRequest,
  type TutorActionResponse,
  type TutorContext,
  type TutorHistoryMessage,
  type TutorSessionState,
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
const failure = (code: TutorWorkflowFailure["code"]): TutorWorkflowFailure => ({
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
      history: selectTutorContextHistory(snapshot.state.history),
    }).pipe(Effect.mapError(() => failure("invalid-session")));
    if (
      action.action === "targeted-quiz" &&
      !context.knowledgeArea.objectives.some((item) => item.id === action.objectiveId)
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

/** Provider effects are supplied by the app boundary; vendor failures retain their type. */
export interface TutorWorkflowProvider<E> {
  readonly capabilities: AiProviderCapabilities;
  readonly generateQuestion: (context: TutorContext) => Effect.Effect<unknown, E>;
  readonly evaluateAnswer: (
    context: TutorContext & { readonly answer: string },
  ) => Effect.Effect<unknown, E>;
  readonly proposeCard: (
    context: TutorContext & { readonly observation: AnswerEvaluation },
  ) => Effect.Effect<unknown, E>;
  readonly generateTargetedQuiz: (
    context: TutorContext & { readonly objectiveId: string },
  ) => Effect.Effect<unknown, E>;
}
const MeteringSchema = Schema.Struct({
  result: Schema.Unknown,
  inputTokens: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  outputTokens: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  model: Schema.String.pipe(Schema.minLength(1)),
});
export type TutorWorkflowTransition = {
  readonly response: TutorActionResponse;
  readonly snapshot: TutorWorkflowSnapshot;
  readonly appendedHistory: readonly TutorHistoryMessage[];
  readonly metering: Omit<typeof MeteringSchema.Type, "result">;
};
function decodeResult<A, I>(schema: Schema.Schema<A, I>, input: unknown) {
  return Schema.decodeUnknown(schema)(input).pipe(
    Effect.mapError(() => failure("invalid-provider-response")),
  );
}

/** Dispatch inference and derive the same validated transition for hosted and local clients. */
export function executeTutorWorkflow<E, F = never>(
  prepared: PreparedTutorWorkflow,
  provider: TutorWorkflowProvider<E>,
  proposalId: string,
  onMetered?: (metering: TutorWorkflowTransition["metering"]) => Effect.Effect<void, F>,
): Effect.Effect<TutorWorkflowTransition, TutorWorkflowFailure | AiContextBudgetExceeded | E | F> {
  return Effect.gen(function* () {
    const { action, snapshot } = prepared;
    const context = snapshot.context;
    const decodedCapabilities = Schema.decodeUnknownEither(AiProviderCapabilitiesSchema)(
      provider.capabilities,
    );
    if (Either.isLeft(decodedCapabilities))
      return yield* Effect.fail(failure("invalid-provider-capabilities"));
    const capabilities = decodedCapabilities.right;
    const operation = action.action === "evaluate-quiz-answer" ? "evaluate" : action.action;
    if (!capabilities.supportedOperations.includes(operation))
      return yield* Effect.fail(failure("unsupported-operation"));
    if (!capabilities.structuredOutputs)
      return yield* Effect.fail(failure("structured-output-unsupported"));
    const maxInputBytes = Math.min(MAX_TUTOR_INFERENCE_BYTES, capabilities.maxInputBytes);
    let inference: Effect.Effect<unknown, E | AiContextBudgetExceeded>;
    const bounded: TutorWorkflowProvider<E | AiContextBudgetExceeded> = {
      capabilities,
      generateQuestion: (data) =>
        selectTutorInferenceContext(data, maxInputBytes).pipe(
          Effect.flatMap(provider.generateQuestion),
        ),
      evaluateAnswer: (data) =>
        selectTutorInferenceContext(
          data,
          maxInputBytes,
          snapshot.state.quiz?.objectiveId ?? snapshot.state.evaluation?.objectiveId,
        ).pipe(Effect.flatMap(provider.evaluateAnswer)),
      proposeCard: (data) =>
        selectTutorInferenceContext(data, maxInputBytes).pipe(Effect.flatMap(provider.proposeCard)),
      generateTargetedQuiz: (data) =>
        selectTutorInferenceContext(data, maxInputBytes).pipe(
          Effect.flatMap(provider.generateTargetedQuiz),
        ),
    };
    if (action.action === "question") inference = bounded.generateQuestion(context);
    else if (action.action === "targeted-quiz")
      inference = bounded.generateTargetedQuiz({ ...context, objectiveId: action.objectiveId });
    else if (action.action === "propose-card") {
      const observation = snapshot.state.evaluation;
      if (!observation) return yield* Effect.fail(failure("observation-not-found"));
      inference = bounded.proposeCard({ ...context, observation });
    } else if (action.action === "evaluate-quiz-answer") {
      const question = snapshot.state.quiz?.questions[action.questionIndex];
      if (!question) return yield* Effect.fail(failure("quiz-question-not-found"));
      inference = bounded.evaluateAnswer({
        ...context,
        history: selectTutorContextHistory([
          ...context.history,
          { role: "assistant", content: question.prompt },
          {
            role: "assistant",
            content: `Evaluate this question for objective ${snapshot.state.quiz.objectiveId}. Use this expected answer as evaluation guidance: ${question.expectedAnswer}`,
          },
        ]),
        answer: action.answer,
      });
    } else inference = bounded.evaluateAnswer({ ...context, answer: action.answer });
    const metered = yield* decodeResult(MeteringSchema, yield* inference);
    if (onMetered)
      yield* onMetered({
        inputTokens: metered.inputTokens,
        outputTokens: metered.outputTokens,
        model: metered.model,
      });
    if (
      capabilities.maxOutputTokens !== null &&
      metered.outputTokens !== null &&
      metered.outputTokens > capabilities.maxOutputTokens
    )
      return yield* Effect.fail(failure("output-budget-exceeded"));
    let state: TutorSessionState = snapshot.state;
    let response: TutorActionResponse;
    let appendedHistory: readonly TutorHistoryMessage[] = [];
    let pendingQuestion = snapshot.pendingQuestion;
    if (action.action === "question") {
      const result = yield* decodeResult(TutorQuestionSchema, metered.result);
      response = { action: action.action, sessionId: state.sessionId, result };
      appendedHistory = [{ role: "assistant", content: result.question }];
      state = { ...state, evaluation: null, proposal: null, quiz: null };
      pendingQuestion = true;
    } else if (action.action === "targeted-quiz") {
      const result = yield* decodeResult(TargetedQuizSchema, metered.result);
      const objective = context.knowledgeArea.objectives.find(
        (item) => item.id === action.objectiveId,
      );
      if (!objective || result.objectiveId !== objective.id)
        return yield* Effect.fail(failure("invalid-provider-response"));
      const quiz = { ...result, objectiveTitle: objective.title };
      response = { action: action.action, sessionId: state.sessionId, result: quiz };
      state = {
        ...state,
        evaluation: null,
        proposal: null,
        quiz: {
          ...quiz,
          questions: quiz.questions.map((question) => ({
            ...question,
            learnerAnswer: null,
            evaluation: null,
          })),
        },
      };
      pendingQuestion = false;
    } else if (action.action === "propose-card") {
      const result = yield* decodeResult(CardProposalSchema, metered.result);
      response = { action: action.action, sessionId: state.sessionId, proposalId, result };
      state = { ...state, proposal: { proposalId, content: result } };
    } else {
      const result = yield* decodeResult(AnswerEvaluationSchema, metered.result);
      appendedHistory = [
        { role: "learner", content: action.answer },
        { role: "assistant", content: result.feedback },
      ];
      state = {
        ...state,
        evaluation: result,
        proposal: null,
        observations: [...(state.observations ?? []), result].slice(
          -MAX_TUTOR_SESSION_OBSERVATIONS,
        ),
      };
      pendingQuestion = false;
      if (action.action === "evaluate-quiz-answer") {
        const quiz = state.quiz;
        if (!quiz || result.objectiveId !== quiz.objectiveId)
          return yield* Effect.fail(failure("invalid-provider-response"));
        const updatedQuiz = {
          ...quiz,
          questions: quiz.questions.map((question, index) =>
            index === action.questionIndex
              ? { ...question, learnerAnswer: action.answer, evaluation: result }
              : question,
          ),
        };
        state = { ...state, quiz: updatedQuiz };
        response = {
          action: action.action,
          sessionId: state.sessionId,
          questionIndex: action.questionIndex,
          result,
          quiz: updatedQuiz,
        };
      } else {
        state = { ...state, quiz: null };
        response = { action: action.action, sessionId: state.sessionId, result };
      }
    }
    if (
      response.result.objectiveId !== null &&
      !context.knowledgeArea.objectives.some((item) => item.id === response.result.objectiveId)
    )
      return yield* Effect.fail(failure("invalid-provider-response"));
    const validatedResponse = yield* decodeResult(TutorActionResponseSchema, response);
    const validatedState = yield* decodeResult(TutorSessionStateSchema, {
      ...state,
      history: selectTutorContextHistory([...state.history, ...appendedHistory]),
    });
    return {
      response: validatedResponse,
      snapshot: {
        context: { ...context, history: validatedState.history },
        state: validatedState,
        pendingQuestion,
      },
      appendedHistory,
      metering: {
        inputTokens: metered.inputTokens,
        outputTokens: metered.outputTokens,
        model: metered.model,
      },
    };
  });
}

/** Validate resolution intent before the adapter's atomic pending-state update. */
export function validateTutorProposalResolution(input: unknown) {
  return Schema.decodeUnknown(ResolveProposalRequestSchema)(input).pipe(
    Effect.mapError(() => failure("invalid-request")),
    Effect.flatMap((request) =>
      request.state === "approved" && request.cardId !== cardIdForTutorProposal(request.proposalId)
        ? Effect.fail(failure("invalid-request"))
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
      return yield* Effect.fail(failure("proposal-not-found"));
    if (
      request.content?.objectiveId != null &&
      !snapshot.context.knowledgeArea.objectives.some(
        (item) => item.id === request.content?.objectiveId,
      )
    )
      return yield* Effect.fail(failure("unknown-objective"));
    return { ...snapshot, state: { ...snapshot.state, proposal: null } };
  });
}
