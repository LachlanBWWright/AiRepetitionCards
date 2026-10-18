import { createTutorQuestionTransition } from "./tutor-question-transition";
import { Effect, Either, Schema } from "effect";
import {
  tutorWorkflowFailure as failure,
  type PreparedTutorWorkflow,
  type TutorWorkflowFailure,
  type TutorWorkflowSnapshot,
} from "./tutor-workflow-prepare";

export { prepareTutorWorkflow } from "./tutor-workflow-prepare";
export {
  resolveTutorWorkflowProposal,
  validateTutorProposalResolution,
} from "./tutor-workflow-prepare";
export type {
  PreparedTutorWorkflow,
  TutorWorkflowFailure,
  TutorWorkflowSnapshot,
} from "./tutor-workflow-prepare";
import {
  CardRefinementResultSchema,
  CardInspectionResultSchema,
  StudyPlanResultSchema,
  type CardRefinementInput,
  type CardInspectionInput,
  type StudyPlanInput,
  type StudySourceReference,
  type StudySourcePassage,
  AnswerEvaluationSchema,
  StudyCardResultSchema,
  type StudyCardInput,
  AiProviderCapabilitiesSchema,
  MAX_TUTOR_INFERENCE_BYTES,
  type AiProviderCapabilities,
  CardProposalSchema,
  MAX_TUTOR_SESSION_OBSERVATIONS,
  TargetedQuizSchema,
  TutorActionResponseSchema,
  TutorSessionStateSchema,
  selectTutorContextHistory,
  selectTutorInferenceContext,
  type AiContextBudgetExceeded,
  type AnswerEvaluation,
  type TutorActionResponse,
  type TutorContext,
  type TutorHistoryMessage,
  type TutorSessionState,
} from "@recall/ai-core";

/** Provider effects are supplied by the app boundary; vendor failures retain their type. */
export interface TutorWorkflowProvider<E> {
  readonly refineCard?: (
    context: TutorContext & { readonly refinement: CardRefinementInput },
  ) => Effect.Effect<unknown, E>;
  readonly inspectCard?: (
    context: TutorContext & { readonly inspection: CardInspectionInput },
  ) => Effect.Effect<unknown, E>;
  readonly planStudy?: (
    context: TutorContext & { readonly material: StudyPlanInput },
  ) => Effect.Effect<unknown, E>;
  readonly generateStudyCard?: (
    context: TutorContext & { readonly material: StudyCardInput },
  ) => Effect.Effect<unknown, E>;
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

function validReferences(
  references: readonly StudySourceReference[],
  sources: readonly StudySourcePassage[],
): boolean {
  return references.every((reference) =>
    sources.some(
      (source) =>
        source.materialId === reference.materialId &&
        source.sectionId === reference.sectionId &&
        source.pageNumber === reference.pageNumber &&
        source.text.includes(reference.quote),
    ),
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
    if (action.action === "refine-card") {
      if (!provider.refineCard) return yield* Effect.fail(failure("unsupported-operation"));
      inference = provider.refineCard(
        yield* selectTutorInferenceContext(
          { ...context, refinement: action.refinement },
          maxInputBytes,
        ),
      );
    } else if (action.action === "inspect-card") {
      if (!provider.inspectCard) return yield* Effect.fail(failure("unsupported-operation"));
      inference = provider.inspectCard(
        yield* selectTutorInferenceContext(
          { ...context, inspection: action.inspection },
          maxInputBytes,
        ),
      );
    } else if (action.action === "plan-study") {
      if (!provider.planStudy) return yield* Effect.fail(failure("unsupported-operation"));
      inference = provider.planStudy(
        yield* selectTutorInferenceContext(
          { ...context, material: action.material },
          maxInputBytes,
        ),
      );
    } else if (action.action === "study-card") {
      if (!provider.generateStudyCard) return yield* Effect.fail(failure("unsupported-operation"));
      const materialContext = yield* selectTutorInferenceContext(
        { ...context, material: action.material },
        maxInputBytes,
      );
      inference = provider.generateStudyCard(materialContext);
    } else if (action.action === "question") inference = bounded.generateQuestion(context);
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
    if (action.action === "refine-card") {
      const result = yield* decodeResult(CardRefinementResultSchema, metered.result);
      if (
        result.cards.some(
          (card) =>
            card.objectiveId !== action.refinement.objectiveId ||
            !validReferences(card.sourceReferences, action.refinement.sources) ||
            (action.refinement.sources.length > 0 && card.sourceReferences.length === 0) ||
            (action.refinement.mode === "cloze" && !/\{\{c[1-9]\d*::[^{}]+\}\}/u.test(card.front)),
        )
      )
        return yield* Effect.fail(failure("invalid-provider-response"));
      response = { action: action.action, sessionId: state.sessionId, result };
    } else if (action.action === "inspect-card") {
      const result = yield* decodeResult(CardInspectionResultSchema, metered.result);
      response = { action: action.action, sessionId: state.sessionId, result };
    } else if (action.action === "plan-study") {
      const result = yield* decodeResult(StudyPlanResultSchema, metered.result);
      if (
        result.claims.some(
          (claim) => !validReferences(claim.sourceReferences, action.material.sources),
        )
      )
        return yield* Effect.fail(failure("invalid-provider-response"));
      response = { action: action.action, sessionId: state.sessionId, result };
    } else if (action.action === "study-card") {
      const result = yield* decodeResult(StudyCardResultSchema, metered.result);
      if (
        result.proposal.objectiveId !== action.material.objectiveId ||
        result.sourceReferences.some(
          (reference) =>
            !action.material.sources.some(
              (source) =>
                source.materialId === reference.materialId &&
                source.sectionId === reference.sectionId &&
                source.pageNumber === reference.pageNumber &&
                source.text.includes(reference.quote),
            ),
        )
      )
        return yield* Effect.fail(failure("invalid-provider-response"));
      response = {
        action: "study-card",
        sessionId: state.sessionId,
        proposalId,
        result,
        providerResolutionRequired: true,
      };
      state = { ...state, proposal: { proposalId, content: result.proposal } };
      pendingQuestion = false;
    } else if (action.action === "question") {
      const question = yield* createTutorQuestionTransition(
        metered.result,
        context,
        state,
        proposalId,
      );
      response = question.response;
      appendedHistory = question.appendedHistory;
      state = question.state;
      pendingQuestion = question.pendingQuestion;
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
    const resultObjectiveId =
      response.action === "study-card"
        ? response.result.proposal.objectiveId
        : "objectiveId" in response.result
          ? response.result.objectiveId
          : null;
    if (
      resultObjectiveId !== null &&
      !context.knowledgeArea.objectives.some((item) => item.id === resultObjectiveId)
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
