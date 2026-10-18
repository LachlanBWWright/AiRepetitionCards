export {
  TUTOR_CONTEXT_TOKEN_LIMIT,
  MAX_CHAT_TRANSPORT_BYTES,
  MAX_CHAT_CONTEXT_MESSAGES,
  TutorTokenUsageSchema,
  TutorInferenceReplySchema,
  type TutorTokenUsage,
  type TutorInferenceReply,
} from "./tutor-token-usage";
import { Context, Effect, Schema } from "effect";
import { type AiContextBudgetExceeded, type TutorContext } from "./tutor-context";
export {
  TUTOR_QUESTION_INSTRUCTIONS,
  IMPROVEMENT_CHAT_INSTRUCTIONS,
  MAX_TUTOR_CONTEXT_MESSAGES,
  MAX_TUTOR_HISTORY_BYTES,
  TutorHistoryMessageSchema,
  selectTutorContextHistory,
  TutorInvestigationSchema,
  TutorContextSchema,
  MAX_TUTOR_INFERENCE_BYTES,
  tutorContextBytes,
  selectTutorInferenceContext,
  type TutorHistoryMessage,
  type AiContextBudgetExceeded,
  type TutorContext,
} from "./tutor-context";
export {
  KnowledgeGapSchema,
  identifyObjectiveGaps,
  type KnowledgeGap,
} from "./index-objective-gaps";
import type {
  CardRefinementInput,
  CardRefinementResult,
  CardInspectionInput,
  CardInspectionResult,
  StudyPlanInput,
  StudyPlanResult,
  StudyCardInput,
  StudyCardResult,
} from "./index-study-assistance";
import type {
  AnswerEvaluation,
  CardProposal,
  TargetedQuiz,
  TutorQuestion,
} from "./index-tutor-contracts";
export * from "./index-tutor-contracts";
export {
  CardProposalSchema,
  CardRefinementInputSchema,
  CardRefinementResultSchema,
  CardInspectionInputSchema,
  CardInspectionResultSchema,
  StudySourcePassageSchema,
  StudySourceReferenceSchema,
  StudyPlanInputSchema,
  StudyPlanResultSchema,
  StudyCardInputSchema,
  StudyCardResultSchema,
  type CardRefinementInput,
  type CardRefinementResult,
  type CardInspectionInput,
  type CardInspectionResult,
  type StudyPlanInput,
  type StudyPlanResult,
  type StudySourcePassage,
  type StudySourceReference,
  type StudyCardInput,
  type StudyCardResult,
} from "./index-study-assistance";

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
  "refine-card",
  "inspect-card",
  "plan-study",
  "question",
  "evaluate",
  "propose-card",
  "targeted-quiz",
  "study-card",
);
export type AiOperation = typeof AiOperationSchema.Type;

/** Runtime adapter guarantees; these are separate from model identity and funding. */
export const AiProviderCapabilitiesSchema = Schema.Struct({
  supportedOperations: Schema.Array(AiOperationSchema).pipe(Schema.minItems(1), Schema.maxItems(8)),
  structuredOutputs: Schema.Boolean,
  streaming: Schema.Boolean,
  maxInputBytes: Schema.Number.pipe(Schema.int(), Schema.positive()),
  // Null means this adapter cannot configure a model output-token ceiling.
  maxOutputTokens: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
});
export type AiProviderCapabilities = typeof AiProviderCapabilitiesSchema.Type;

export interface AiProviderService {
  readonly refineCard?: (
    context: TutorContext & { readonly refinement: CardRefinementInput },
  ) => Effect.Effect<AiProviderResult<CardRefinementResult>, AiProviderError>;
  readonly inspectCard?: (
    context: TutorContext & { readonly inspection: CardInspectionInput },
  ) => Effect.Effect<AiProviderResult<CardInspectionResult>, AiProviderError>;
  readonly planStudy?: (
    context: TutorContext & { readonly material: StudyPlanInput },
  ) => Effect.Effect<AiProviderResult<StudyPlanResult>, AiProviderError>;
  readonly generateStudyCard?: (
    context: TutorContext & { readonly material: StudyCardInput },
  ) => Effect.Effect<AiProviderResult<StudyCardResult>, AiProviderError>;
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

export { combineObjectiveGapsWithTutorEvidence } from "./tutor-gaps";
