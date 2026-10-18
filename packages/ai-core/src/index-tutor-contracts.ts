import { Effect, Either, Schema } from "effect";
import { AssessmentIdSchema } from "@recall/domain";
import { TutorContextSchema, type TutorContext } from "./tutor-context";
import {
  CardProposalSchema,
  CardRefinementInputSchema,
  CardRefinementResultSchema,
  CardInspectionInputSchema,
  CardInspectionResultSchema,
  StudyPlanInputSchema,
  StudyPlanResultSchema,
  StudyCardInputSchema,
  StudyCardResultSchema,
} from "./index-study-assistance";

const ObjectiveIdSchema = Schema.NullOr(Schema.String.pipe(Schema.minLength(1)));
const ConfidenceSchema = Schema.Number.pipe(
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(1),
);
const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);

export const TutorQuestionSchema = Schema.Struct({
  proposal: Schema.optional(Schema.NullOr(CardProposalSchema)),
  question: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  objectiveId: ObjectiveIdSchema,
  teachingIntent: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
  explanation: Schema.optional(
    Schema.NullOr(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(3000))),
  ),
  conceptSuggestions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
        description: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
      }),
    ).pipe(Schema.maxItems(8)),
  ),
});

export const AnswerEvaluationSchema = Schema.Struct({
  result: Schema.Union(
    Schema.Literal("mastered"),
    Schema.Literal("partial"),
    Schema.Literal("incorrect"),
    Schema.Literal("uncertain"),
  ),
  confidence: ConfidenceSchema,
  feedback: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(3000)),
  misconception: Schema.NullOr(Schema.String.pipe(Schema.maxLength(1000))),
  objectiveId: ObjectiveIdSchema,
  suggestedAction: Schema.Union(
    Schema.Literal("review-existing-card"),
    Schema.Literal("propose-card"),
    Schema.Literal("targeted-quiz"),
    Schema.Literal("explain"),
    Schema.Literal("none"),
  ),
});

export const TargetedQuizSchema = Schema.Struct({
  objectiveId: Schema.String.pipe(Schema.minLength(1)),
  objectiveTitle: Schema.String.pipe(Schema.minLength(1)),
  questions: Schema.Array(
    Schema.Struct({
      prompt: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
      expectedAnswer: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
    }),
  ).pipe(Schema.minItems(2), Schema.maxItems(5)),
});

export const TargetedQuizSessionSchema = Schema.Struct({
  objectiveId: Schema.String.pipe(Schema.minLength(1)),
  objectiveTitle: Schema.String.pipe(Schema.minLength(1)),
  questions: Schema.Array(
    Schema.Struct({
      prompt: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
      expectedAnswer: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
      learnerAnswer: Schema.NullOr(Schema.String.pipe(Schema.maxLength(8000))),
      evaluation: Schema.NullOr(AnswerEvaluationSchema),
    }),
  ).pipe(Schema.minItems(2), Schema.maxItems(5)),
});

export const TutorActionRequestSchema = Schema.Union(
  ...([
    Schema.Struct({
      action: Schema.Literal("refine-card"),
      context: TutorContextSchema,
      refinement: CardRefinementInputSchema,
      sessionId: Schema.optional(UuidSchema),
      canonicalAreaFingerprint: Schema.optional(
        Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
      ),
    }),
    Schema.Struct({
      action: Schema.Literal("inspect-card"),
      context: TutorContextSchema,
      inspection: CardInspectionInputSchema,
      sessionId: Schema.optional(UuidSchema),
      canonicalAreaFingerprint: Schema.optional(
        Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
      ),
    }),
    Schema.Struct({
      action: Schema.Literal("plan-study"),
      context: TutorContextSchema,
      material: StudyPlanInputSchema,
      sessionId: Schema.optional(UuidSchema),
      canonicalAreaFingerprint: Schema.optional(
        Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
      ),
    }),
  ] as const),
  Schema.Struct({
    action: Schema.Literal("study-card"),
    context: TutorContextSchema,
    material: StudyCardInputSchema,
    canonicalAreaFingerprint: Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))),
    sessionId: Schema.optional(UuidSchema),
  }),
  Schema.Struct({
    action: Schema.Literal("question"),
    context: TutorContextSchema,
    canonicalAreaFingerprint: Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))),
    sessionId: Schema.optional(UuidSchema),
  }),
  Schema.Struct({
    action: Schema.Literal("evaluate"),
    sessionId: UuidSchema,
    answer: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(8000)),
  }),
  Schema.Struct({
    action: Schema.Literal("propose-card"),
    sessionId: UuidSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("targeted-quiz"),
    objectiveId: Schema.String.pipe(Schema.minLength(1)),
    sessionId: Schema.optional(UuidSchema),
    context: Schema.optional(TutorContextSchema),
    canonicalAreaFingerprint: Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))),
  }),
  Schema.Struct({
    action: Schema.Literal("evaluate-quiz-answer"),
    sessionId: UuidSchema,
    questionIndex: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    answer: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(8000)),
  }),
);

export const TutorActionResponseSchema = Schema.Union(
  Schema.Struct({
    action: Schema.Literal("refine-card"),
    sessionId: UuidSchema,
    result: CardRefinementResultSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("inspect-card"),
    sessionId: UuidSchema,
    result: CardInspectionResultSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("plan-study"),
    sessionId: UuidSchema,
    result: StudyPlanResultSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("study-card"),
    sessionId: UuidSchema,
    proposalId: UuidSchema,
    result: StudyCardResultSchema,
    providerResolutionRequired: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    action: Schema.Literal("question"),
    sessionId: UuidSchema,
    proposalId: Schema.optional(UuidSchema),
    providerResolutionRequired: Schema.optional(Schema.Boolean),
    result: TutorQuestionSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("evaluate"),
    sessionId: UuidSchema,
    result: AnswerEvaluationSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("propose-card"),
    sessionId: UuidSchema,
    proposalId: UuidSchema,
    result: CardProposalSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("targeted-quiz"),
    sessionId: UuidSchema,
    result: TargetedQuizSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("evaluate-quiz-answer"),
    sessionId: UuidSchema,
    questionIndex: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    result: AnswerEvaluationSchema,
    quiz: TargetedQuizSessionSchema,
  }),
);

export const TutorProposalResolution = { Approved: "approved", Rejected: "rejected" } as const;
export type TutorProposalResolution =
  (typeof TutorProposalResolution)[keyof typeof TutorProposalResolution];
export const ResolveProposalRequestSchema = Schema.Struct({
  proposalId: UuidSchema,
  state: Schema.Literal(TutorProposalResolution.Approved, TutorProposalResolution.Rejected),
  content: Schema.optional(CardProposalSchema),
  cardId: Schema.optional(UuidSchema),
});

/** Use one proposal-derived card ID across clients so retries and cross-device approval converge. */
export function cardIdForTutorProposal(proposalId: unknown) {
  const decodedProposalId = Schema.decodeUnknownEither(UuidSchema)(proposalId);
  if (Either.isLeft(decodedProposalId)) return null;
  const decodedCardId = Schema.decodeUnknownEither(AssessmentIdSchema)(decodedProposalId.right);
  return Either.isRight(decodedCardId) ? decodedCardId.right : null;
}

export const MAX_TUTOR_SESSION_OBSERVATIONS = 100;
export const TutorObservationHistorySchema = Schema.Array(AnswerEvaluationSchema).pipe(
  Schema.maxItems(MAX_TUTOR_SESSION_OBSERVATIONS),
);

export const TutorSessionStateSchema = Schema.Struct({
  sessionId: UuidSchema,
  history: TutorContextSchema.fields.history,
  evaluation: Schema.NullOr(AnswerEvaluationSchema),
  observations: Schema.optional(TutorObservationHistorySchema),
  proposal: Schema.NullOr(Schema.Struct({ proposalId: UuidSchema, content: CardProposalSchema })),
  quiz: Schema.NullOr(TargetedQuizSessionSchema),
});
export type TutorSessionState = typeof TutorSessionStateSchema.Type;

/** Stable HTTP envelopes shared by web, desktop, and native tutor transports. */
export const TutorApiRequestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  request: TutorActionRequestSchema,
});
export const TutorApiResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  response: TutorActionResponseSchema,
});
export const TutorSessionStateResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  state: TutorSessionStateSchema,
});
export const ResolveTutorProposalRequestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  request: ResolveProposalRequestSchema,
});
export const ResolveTutorProposalResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  proposalId: UuidSchema,
  state: Schema.Union(Schema.Literal("approved"), Schema.Literal("rejected")),
});

export type TutorQuestion = typeof TutorQuestionSchema.Type;
export type AnswerEvaluation = typeof AnswerEvaluationSchema.Type;
export type CardProposal = typeof CardProposalSchema.Type;
export type TargetedQuiz = typeof TargetedQuizSchema.Type;
export type TargetedQuizSession = typeof TargetedQuizSessionSchema.Type;
export type TutorActionRequest = typeof TutorActionRequestSchema.Type;
export type TutorActionResponse = typeof TutorActionResponseSchema.Type;

export type AiInputError = {
  readonly _tag: "AiInputError";
  readonly reason: "invalid-shape" | "unknown-objective";
};

export function decodeTutorContext(input: unknown): Effect.Effect<TutorContext, AiInputError> {
  const decoded = Schema.decodeUnknownEither(TutorContextSchema)(input);
  if (Either.isLeft(decoded)) return Effect.fail({ _tag: "AiInputError", reason: "invalid-shape" });
  const objectiveIds = new Set(
    decoded.right.knowledgeArea.objectives.map((objective) => objective.id),
  );
  const contentIds = [
    ...decoded.right.knowledgeArea.objectives.map((objective) => objective.id),
    ...decoded.right.knowledgeArea.cards.map((card) => card.id),
  ];
  const hasDuplicateIds = new Set(contentIds).size !== contentIds.length;
  const unknownReference =
    decoded.right.knowledgeArea.objectives.some((objective) =>
      objective.prerequisiteIds.some((id) => !objectiveIds.has(id)),
    ) ||
    decoded.right.knowledgeArea.cards.some((card) =>
      card.objectiveIds.some((id) => !objectiveIds.has(id)),
    );
  return hasDuplicateIds || unknownReference
    ? Effect.fail({ _tag: "AiInputError", reason: "unknown-objective" })
    : Effect.succeed(decoded.right);
}

export function decodeTutorActionRequest(
  input: unknown,
): Effect.Effect<TutorActionRequest, AiInputError> {
  const decoded = Schema.decodeUnknownEither(TutorActionRequestSchema)(input);
  if (Either.isLeft(decoded)) {
    return Effect.fail({ _tag: "AiInputError", reason: "invalid-shape" });
  }
  const operation = decoded.right;
  if (operation.action === "targeted-quiz") {
    if (!operation.sessionId && !operation.context) {
      return Effect.fail({ _tag: "AiInputError", reason: "invalid-shape" });
    }
    if (!operation.context) return Effect.succeed(operation);
    const context = Effect.either(decodeTutorContext(operation.context));
    return Effect.flatMap(context, (result) => {
      if (Either.isLeft(result)) return Effect.fail(result.left);
      if (
        !result.right.knowledgeArea.objectives.some(
          (objective) => objective.id === operation.objectiveId,
        )
      ) {
        return Effect.fail({ _tag: "AiInputError", reason: "unknown-objective" });
      }
      return Effect.succeed({ ...operation, context: result.right });
    });
  }
  if (!("context" in decoded.right)) return Effect.succeed(decoded.right);
  const context = Effect.either(decodeTutorContext(decoded.right.context));
  return Effect.flatMap(context, (result) => {
    if (Either.isLeft(result)) return Effect.fail(result.left);
    return Effect.succeed({ ...decoded.right, context: result.right } as TutorActionRequest);
  });
}
