import { Context, Effect, Either, Schema } from "effect";
import {
  CardIdSchema,
  KnowledgeAreaSchema,
  type LearningArea,
  type ReviewEvent,
} from "@recall/domain";

const ObjectiveIdSchema = Schema.NullOr(Schema.String.pipe(Schema.minLength(1)));
const ConfidenceSchema = Schema.Number.pipe(
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(1),
);
const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);

export const MAX_TUTOR_CONTEXT_MESSAGES = 40;
export const MAX_TUTOR_HISTORY_BYTES = 48 * 1024;
export const TutorHistoryMessageSchema = Schema.Struct({
  role: Schema.Union(Schema.Literal("assistant"), Schema.Literal("learner")),
  content: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(8000)),
});
export type TutorHistoryMessage = typeof TutorHistoryMessageSchema.Type;

/** Keep a chronological recent window within message and encoded-byte budgets.
 * Persisted private history remains untouched. */
export function selectTutorContextHistory(
  history: readonly TutorHistoryMessage[],
): readonly TutorHistoryMessage[] {
  const recent = history.slice(-MAX_TUTOR_CONTEXT_MESSAGES);
  let bytes = 2;
  let start = recent.length;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    if (!message) break;
    // Count UTF-8 bytes without requiring a platform TextEncoder polyfill.
    let messageBytes = 1;
    for (const character of JSON.stringify(message)) {
      const point = character.codePointAt(0) ?? 0;
      messageBytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    if (bytes + messageBytes > MAX_TUTOR_HISTORY_BYTES) break;
    bytes += messageBytes;
    start = index;
  }
  return recent.slice(start);
}

export const TutorContextSchema = Schema.Struct({
  knowledgeArea: KnowledgeAreaSchema,
  history: Schema.Array(TutorHistoryMessageSchema).pipe(
    Schema.maxItems(MAX_TUTOR_CONTEXT_MESSAGES),
  ),
});

export const MAX_TUTOR_INFERENCE_BYTES = 80_000;
export type AiContextBudgetExceeded = { readonly _tag: "AiContextBudgetExceeded" };
/** Portable UTF-8 JSON size; no browser or native TextEncoder dependency. */
export function tutorContextBytes(value: unknown): number {
  let bytes = 0;
  for (const character of JSON.stringify(value)) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Select inference data only; retain full canonical content in the workflow/store.
 * Required policy, objective definitions, answer/evidence and newest dialogue stay intact. */
export function selectTutorInferenceContext<T extends TutorContext>(
  input: T,
  maxBytes = MAX_TUTOR_INFERENCE_BYTES,
  priorityObjectiveId?: string | null,
): Effect.Effect<T, AiContextBudgetExceeded> {
  return Effect.gen(function* () {
    const recent = selectTutorContextHistory(input.history);
    const complete = { ...input, history: recent };
    if (tutorContextBytes(complete) <= maxBytes) return complete;
    const area = input.knowledgeArea;
    let selected: T = {
      ...input,
      knowledgeArea: { ...area, description: null, tags: [], cards: [] },
      history: recent.slice(-2),
    };
    if (tutorContextBytes(selected) > maxBytes)
      return yield* Effect.fail({ _tag: "AiContextBudgetExceeded" } as const);
    const objective =
      priorityObjectiveId ??
      ("objectiveId" in input && typeof input.objectiveId === "string"
        ? input.objectiveId
        : null) ??
      ("observation" in input &&
      typeof input.observation === "object" &&
      input.observation !== null &&
      "objectiveId" in input.observation &&
      typeof input.observation.objectiveId === "string"
        ? input.observation.objectiveId
        : null);
    const ordered = [...area.cards].sort((left, right) => {
      const priority =
        Number(right.objectiveIds.some((id) => id === objective)) -
        Number(left.objectiveIds.some((id) => id === objective));
      return priority || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    });
    // Reserve room for recent dialogue, then add relevant cards in stable order.
    let usedBytes = tutorContextBytes(selected);
    const cardBudget = Math.max(usedBytes, maxBytes - 16_000);
    for (const card of ordered) {
      const candidate = {
        ...selected,
        knowledgeArea: {
          ...selected.knowledgeArea,
          cards: [...selected.knowledgeArea.cards, card],
        },
      };
      const nextBytes =
        usedBytes + tutorContextBytes(card) + (selected.knowledgeArea.cards.length > 0 ? 1 : 0);
      if (nextBytes <= cardBudget) {
        selected = candidate;
        usedBytes = nextBytes;
      }
    }
    for (let index = recent.length - 3; index >= 0; index -= 1) {
      const message = recent[index];
      if (!message) continue;
      const candidate = { ...selected, history: [message, ...selected.history] };
      const nextBytes =
        usedBytes + tutorContextBytes(message) + (selected.history.length > 0 ? 1 : 0);
      if (nextBytes > maxBytes) break;
      selected = candidate;
      usedBytes = nextBytes;
    }
    return selected;
  });
}

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

/** Use one proposal-derived card ID across clients so retries and cross-device approval converge. */
export function cardIdForTutorProposal(proposalId: unknown) {
  const decodedProposalId = Schema.decodeUnknownEither(UuidSchema)(proposalId);
  if (Either.isLeft(decodedProposalId)) return null;
  const decodedCardId = Schema.decodeUnknownEither(CardIdSchema)(decodedProposalId.right);
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
  | AiContextBudgetExceeded
  | { readonly _tag: "AiBudgetExceeded" }
  | { readonly _tag: "AiBudgetUnavailable" }
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

export const AiOperationSchema = Schema.Literal(
  "question",
  "evaluate",
  "propose-card",
  "targeted-quiz",
);
export type AiOperation = typeof AiOperationSchema.Type;

/** Runtime adapter guarantees; these are separate from model identity and funding. */
export const AiProviderCapabilitiesSchema = Schema.Struct({
  supportedOperations: Schema.Array(AiOperationSchema).pipe(Schema.minItems(1), Schema.maxItems(4)),
  structuredOutputs: Schema.Boolean,
  streaming: Schema.Boolean,
  maxInputBytes: Schema.Number.pipe(Schema.int(), Schema.positive()),
  // Null means this adapter cannot configure a model output-token ceiling.
  maxOutputTokens: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
});
export type AiProviderCapabilities = typeof AiProviderCapabilitiesSchema.Type;

export interface AiProviderService {
  readonly capabilities: AiProviderCapabilities;
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
        return { id: `objective-${slug || "learning"}-${String(index + 1)}`, title };
      });
  const gaps: KnowledgeGap[] = [];
  for (const objective of objectives) {
    // Tutor actions target this learner's objective; source identities are provenance only.
    const objectiveId = objective.id;
    const cards = area.cards.filter((card) =>
      card.objectiveIds?.length
        ? card.objectiveIds.some((id) => id === objective.id)
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
        evidenceSummary: `${String(recentFailureCount)} of the last ${String(recent.length)} reviews were rated Again.`,
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
        evidenceSummary: `${String(dueCardCount)} linked ${dueCardCount === 1 ? "card is" : "cards are"} due for review.`,
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

export { combineObjectiveGapsWithTutorEvidence } from "./tutor-gaps";
