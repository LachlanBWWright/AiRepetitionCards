import { Context, Effect, Either, Schema } from "effect";
import { KnowledgeAreaSchema, type LearningArea, type ReviewEvent } from "@recall/domain";

const ObjectiveIdSchema = Schema.NullOr(Schema.String.pipe(Schema.minLength(1)));
const ConfidenceSchema = Schema.Number.pipe(
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(1),
);
const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);

export const TutorContextSchema = Schema.Struct({
  knowledgeArea: KnowledgeAreaSchema,
  history: Schema.Array(
    Schema.Struct({
      role: Schema.Union(Schema.Literal("assistant"), Schema.Literal("learner")),
      content: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(8000)),
    }),
  ).pipe(Schema.maxItems(40)),
});

export const TutorQuestionSchema = Schema.Struct({
  question: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  objectiveId: ObjectiveIdSchema,
  teachingIntent: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
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

export const CardProposalSchema = Schema.Struct({
  front: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
  back: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(3000)),
  objectiveId: ObjectiveIdSchema,
  rationale: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
});

export const KnowledgeGapSchema = Schema.Struct({
  objectiveId: Schema.String.pipe(Schema.minLength(1)),
  objectiveTitle: Schema.String.pipe(Schema.minLength(1)),
  kind: Schema.Union(
    Schema.Literal("uncovered"),
    Schema.Literal("retention-risk"),
    Schema.Literal("due-practice"),
    Schema.Literal("tutor-observation"),
  ),
  severity: Schema.Union(Schema.Literal("high"), Schema.Literal("medium")),
  cardCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  dueCardCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  recentFailureCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  evidenceSummary: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
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
  Schema.Struct({
    action: Schema.Literal("question"),
    context: TutorContextSchema,
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
    action: Schema.Literal("question"),
    sessionId: UuidSchema,
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

export const ResolveProposalRequestSchema = Schema.Struct({
  proposalId: UuidSchema,
  state: Schema.Union(Schema.Literal("approved"), Schema.Literal("rejected")),
  content: Schema.optional(CardProposalSchema),
  cardId: Schema.optional(UuidSchema),
});

export const TutorSessionStateSchema = Schema.Struct({
  sessionId: UuidSchema,
  history: TutorContextSchema.fields.history,
  evaluation: Schema.NullOr(AnswerEvaluationSchema),
  proposal: Schema.NullOr(Schema.Struct({ proposalId: UuidSchema, content: CardProposalSchema })),
  quiz: Schema.NullOr(TargetedQuizSessionSchema),
});
export type TutorSessionState = typeof TutorSessionStateSchema.Type;

export type TutorContext = typeof TutorContextSchema.Type;
export type TutorQuestion = typeof TutorQuestionSchema.Type;
export type AnswerEvaluation = typeof AnswerEvaluationSchema.Type;
export type CardProposal = typeof CardProposalSchema.Type;
export type KnowledgeGap = typeof KnowledgeGapSchema.Type;
export type TargetedQuiz = typeof TargetedQuizSchema.Type;
export type TargetedQuizSession = typeof TargetedQuizSessionSchema.Type;
export type TutorActionRequest = typeof TutorActionRequestSchema.Type;
export type TutorActionResponse = typeof TutorActionResponseSchema.Type;

export type AiProviderError =
  | { readonly _tag: "AiProviderUnavailable" }
  | { readonly _tag: "AiRateLimited" }
  | { readonly _tag: "AiQuotaExceeded" }
  | { readonly _tag: "AiRefusal" }
  | { readonly _tag: "AiStructuredOutputError" };

export type AiProviderResult<A> = {
  readonly result: A;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly model: string;
};

export interface AiProviderService {
  readonly generateQuestion: (
    context: TutorContext,
  ) => Effect.Effect<AiProviderResult<TutorQuestion>, AiProviderError>;
  readonly evaluateAnswer: (
    context: TutorContext & { readonly answer: string },
  ) => Effect.Effect<AiProviderResult<AnswerEvaluation>, AiProviderError>;
  readonly proposeCard: (
    context: TutorContext & { readonly observation: AnswerEvaluation },
  ) => Effect.Effect<AiProviderResult<CardProposal>, AiProviderError>;
  readonly generateTargetedQuiz: (
    context: TutorContext & { readonly objectiveId: string },
  ) => Effect.Effect<AiProviderResult<TargetedQuiz>, AiProviderError>;
}

export class AiProvider extends Context.Tag("@recall/ai-core/AiProvider")<
  AiProvider,
  AiProviderService
>() {}

export function identifyObjectiveGaps(
  area: LearningArea,
  reviewEvents: readonly ReviewEvent[],
  now: Date,
): ReadonlyArray<KnowledgeGap> {
  const objectives = area.objectives?.length
    ? area.objectives
    : Array.from(new Set(area.cards.map((card) => card.objective))).map((title, index) => {
        const slug = title
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        return { id: `objective-${slug || "learning"}-${index + 1}`, title };
      });
  const gaps: KnowledgeGap[] = [];
  for (const objective of objectives) {
    const objectiveId =
      "sourceId" in objective ? (objective.sourceId ?? objective.id) : objective.id;
    const cards = area.cards.filter((card) =>
      card.objectiveIds?.length
        ? card.objectiveIds.includes(objective.id)
        : card.objective === objective.title,
    );
    const cardIds = new Set(cards.map((card) => card.id));
    const dueCardCount = cards.filter(
      (card) => Date.parse(card.schedule.due) <= now.getTime(),
    ).length;
    const recent = reviewEvents
      .filter((event) => event.areaId === area.id && cardIds.has(event.cardId))
      .sort((left, right) => right.ratedAt.localeCompare(left.ratedAt))
      .slice(0, 5);
    const recentFailureCount = recent.filter((event) => event.rating === "again").length;
    if (cards.length === 0) {
      gaps.push({
        objectiveId,
        objectiveTitle: objective.title,
        kind: "uncovered",
        severity: "high",
        cardCount: 0,
        dueCardCount: 0,
        recentFailureCount: 0,
        evidenceSummary: "No study cards are linked to this objective yet.",
      });
      continue;
    }
    if (recentFailureCount >= 2) {
      gaps.push({
        objectiveId,
        objectiveTitle: objective.title,
        kind: "retention-risk",
        severity: "high",
        cardCount: cards.length,
        dueCardCount,
        recentFailureCount,
        evidenceSummary: `${recentFailureCount} of the last ${recent.length} reviews were rated Again.`,
      });
      continue;
    }
    if (dueCardCount > 0) {
      gaps.push({
        objectiveId,
        objectiveTitle: objective.title,
        kind: "due-practice",
        severity: "medium",
        cardCount: cards.length,
        dueCardCount,
        recentFailureCount,
        evidenceSummary: `${dueCardCount} linked ${dueCardCount === 1 ? "card is" : "cards are"} due for review.`,
      });
    }
  }
  return gaps;
}

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
  if (decoded.right.action !== "question") return Effect.succeed(decoded.right);
  const context = Effect.either(decodeTutorContext(decoded.right.context));
  return Effect.flatMap(context, (result) => {
    if (Either.isLeft(result)) return Effect.fail(result.left);
    return Effect.succeed({ ...decoded.right, context: result.right } as TutorActionRequest);
  });
}
