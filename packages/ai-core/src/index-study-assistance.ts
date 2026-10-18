import { Schema } from "effect";

const ObjectiveIdSchema = Schema.NullOr(Schema.String.pipe(Schema.minLength(1)));
const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);

export const CardProposalSchema = Schema.Struct({
  front: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
  back: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(3000)),
  objectiveId: ObjectiveIdSchema,
  rationale: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
});

export const StudySourcePassageSchema = Schema.Struct({
  materialId: UuidSchema,
  sectionId: UuidSchema,
  text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(12000)),
  pageNumber: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
});
export const StudySourceReferenceSchema = Schema.Struct({
  materialId: UuidSchema,
  sectionId: UuidSchema,
  quote: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  pageNumber: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
});
const AssistanceSourcesSchema = Schema.Array(StudySourcePassageSchema).pipe(Schema.maxItems(1));
export const CardRefinementInputSchema = Schema.Struct({
  front: CardProposalSchema.fields.front,
  back: CardProposalSchema.fields.back,
  objectiveId: ObjectiveIdSchema,
  mode: Schema.Literal("clearer", "shorter", "split", "example", "cloze"),
  instructions: Schema.String.pipe(Schema.maxLength(1000)),
  sources: AssistanceSourcesSchema,
});
export const CardRefinementResultSchema = Schema.Struct({
  cards: Schema.Array(
    Schema.Struct({
      ...CardProposalSchema.fields,
      meaningChanged: Schema.Boolean,
      sourceReferences: Schema.Array(StudySourceReferenceSchema).pipe(Schema.maxItems(4)),
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(5)),
});
export const CardInspectionInputSchema = Schema.Struct({
  front: CardProposalSchema.fields.front,
  back: CardProposalSchema.fields.back,
  objectiveId: ObjectiveIdSchema,
  sources: AssistanceSourcesSchema,
});
export const CardInspectionResultSchema = Schema.Struct({
  findings: Schema.Array(
    Schema.Struct({
      kind: Schema.Literal(
        "ambiguity",
        "multiple-facts",
        "answer-leakage",
        "missing-context",
        "unsupported-claim",
        "other",
      ),
      severity: Schema.Literal("warning", "suggestion"),
      explanation: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
      suggestion: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
    }),
  ).pipe(Schema.maxItems(12)),
  summary: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
});
export const StudyPlanInputSchema = Schema.Struct({
  goal: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  depth: Schema.Literal("overview", "standard", "detailed"),
  sources: Schema.Array(StudySourcePassageSchema).pipe(Schema.minItems(1), Schema.maxItems(1)),
});
export const StudyPlanResultSchema = Schema.Struct({
  claims: Schema.Array(
    Schema.Struct({
      title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
      description: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
      priority: Schema.Literal("high", "medium", "low"),
      sourceReferences: Schema.Array(StudySourceReferenceSchema).pipe(
        Schema.minItems(1),
        Schema.maxItems(4),
      ),
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(20)),
});
export type CardRefinementInput = typeof CardRefinementInputSchema.Type;
export type CardRefinementResult = typeof CardRefinementResultSchema.Type;
export type CardInspectionInput = typeof CardInspectionInputSchema.Type;
export type CardInspectionResult = typeof CardInspectionResultSchema.Type;
export type StudyPlanInput = typeof StudyPlanInputSchema.Type;
export type StudyPlanResult = typeof StudyPlanResultSchema.Type;
export type StudySourcePassage = typeof StudySourcePassageSchema.Type;
export type StudySourceReference = typeof StudySourceReferenceSchema.Type;

export const StudyCardInputSchema = Schema.Struct({
  claim: Schema.optional(
    Schema.Struct({
      title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
      description: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
    }),
  ),
  goal: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  depth: Schema.Literal("overview", "standard", "detailed"),
  objectiveId: ObjectiveIdSchema,
  sources: Schema.Array(
    Schema.Struct({
      materialId: UuidSchema,
      sectionId: UuidSchema,
      text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(12000)),
      pageNumber: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(1)),
  previousFronts: Schema.Array(Schema.String.pipe(Schema.maxLength(1000))).pipe(
    Schema.maxItems(30),
  ),
});
export const StudyCardResultSchema = Schema.Struct({
  proposal: CardProposalSchema,
  sourceReferences: Schema.Array(
    Schema.Struct({
      materialId: UuidSchema,
      sectionId: UuidSchema,
      quote: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
      pageNumber: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(4)),
  conceptSuggestions: Schema.Array(
    Schema.Struct({
      title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
      description: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
    }),
  ).pipe(Schema.maxItems(8)),
});
export type StudyCardInput = typeof StudyCardInputSchema.Type;
export type StudyCardResult = typeof StudyCardResultSchema.Type;
