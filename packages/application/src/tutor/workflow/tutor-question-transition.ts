import { Effect, Schema } from "effect";
import { TutorQuestionSchema, type TutorContext, type TutorSessionState } from "@recall/ai-core";
import { tutorWorkflowFailure } from "./tutor-workflow-prepare";
export function createTutorQuestionTransition(
  input: unknown,
  context: TutorContext,
  state: TutorSessionState,
  proposalId: string,
) {
  return Effect.gen(function* () {
    const result = yield* Schema.decodeUnknown(TutorQuestionSchema)(input).pipe(
      Effect.mapError(() => tutorWorkflowFailure("invalid-provider-response")),
    );
    const proposal = result.proposal ?? null;
    if (
      proposal &&
      (!context.improvement ||
        (proposal.objectiveId !== null &&
          !context.knowledgeArea.objectives.some((item) => item.id === proposal.objectiveId)))
    )
      return yield* Effect.fail(tutorWorkflowFailure("invalid-provider-response"));
    return {
      response: {
        action: "question" as const,
        sessionId: state.sessionId,
        result,
        ...(proposal ? { proposalId, providerResolutionRequired: true } : {}),
      },
      appendedHistory: [
        {
          role: "assistant" as const,
          content: context.improvement
            ? [result.explanation, result.question].filter(Boolean).join("\n\n")
            : result.question,
        },
      ],
      state: {
        ...state,
        evaluation: null,
        proposal: proposal ? { proposalId, content: proposal } : null,
        quiz: null,
      },
      pendingQuestion: !context.improvement,
    };
  });
}
