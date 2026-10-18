import { Effect, Schema } from "effect";
import {
  ObjectiveIdSchema,
  AreaIdSchema,
  AssessmentIdSchema,
  ReviewEventSchema,
} from "@recall/domain";
import { AnswerEvaluationSchema, CardProposalSchema, TutorQuestionSchema } from "@recall/ai-core";

export const Uuid = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
export const Time = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.filter(Number.isSafeInteger),
  Schema.lessThanOrEqualTo(8_640_000_000_000_000),
);
export const Text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000));
/** Extracted learning content stays local; no document content establishes learner mastery. */
export const StudyMaterialSectionSchema = Schema.Struct({
  id: Uuid,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  pageNumber: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.between(1, 100_000))),
  text: Text,
  selected: Schema.Boolean,
});
export const StudyMaterialSchema = Schema.Struct({
  id: Uuid,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  format: Schema.Literal("paste", "txt", "markdown", "docx", "pdf", "image"),
  importedAt: Time,
  sections: Schema.Array(StudyMaterialSectionSchema).pipe(Schema.minItems(1), Schema.maxItems(500)),
  warnings: Schema.Array(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000))).pipe(
    Schema.maxItems(100),
  ),
}).pipe(
  Schema.filter(
    (material) =>
      new Set(material.sections.map((section) => section.id)).size === material.sections.length,
  ),
);
export const StudySourceReferenceSchema = Schema.Struct({
  materialId: Uuid,
  sectionId: Uuid,
  quote: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  pageNumber: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.between(1, 100_000))),
});
export const StudyCoverageClaimSchema = Schema.Struct({
  id: Uuid,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  description: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  priority: Schema.Literal("high", "medium", "low"),
  decision: Schema.Literal("pending", "selected", "skipped"),
  sourceReferences: Schema.Array(StudySourceReferenceSchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(20),
  ),
});
export const StudyCoveragePlanSchema = Schema.Struct({
  id: Uuid,
  materialId: Uuid,
  sectionId: Uuid,
  createdAt: Time,
  claims: Schema.Array(StudyCoverageClaimSchema).pipe(Schema.minItems(1), Schema.maxItems(20)),
});
export type StudyCoveragePlan = typeof StudyCoveragePlanSchema.Type;
export type StudyCoverageClaim = typeof StudyCoverageClaimSchema.Type;
export type StudyMaterial = typeof StudyMaterialSchema.Type;
export type StudyMaterialSection = typeof StudyMaterialSectionSchema.Type;
export type StudySourceReference = typeof StudySourceReferenceSchema.Type;
export const NotebookModeSchema = Schema.Literal(
  "diagnostic",
  "clarify",
  "predict",
  "vary",
  "explain",
  "apply",
  "revisit",
);
export type NotebookMode = typeof NotebookModeSchema.Type;
export const NotebookConceptSchema = Schema.Struct({
  id: ObjectiveIdSchema,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  description: Schema.NullOr(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000))),
  parentId: Schema.NullOr(ObjectiveIdSchema),
  objectiveId: Schema.optional(Schema.NullOr(ObjectiveIdSchema)),
  prerequisiteIds: Schema.Array(ObjectiveIdSchema),
});
export const NotebookEvidenceSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("tutor"),
    id: Uuid,
    conceptId: ObjectiveIdSchema,
    question: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
    answer: Schema.String.pipe(Schema.maxLength(8000)),
    learnerConfidence: Schema.Literal("guess", "unsure", "confident"),
    investigationMode: Schema.optional(NotebookModeSchema),
    evaluation: AnswerEvaluationSchema,
    at: Time,
    providerSessionId: Schema.optional(Uuid),
    linkedCardIds: Schema.Array(AssessmentIdSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("review"),
    id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
    conceptId: ObjectiveIdSchema,
    reviewEvent: ReviewEventSchema,
    at: Time,
    linkedCardIds: Schema.Array(AssessmentIdSchema),
  }),
);
export type NotebookEvidence = typeof NotebookEvidenceSchema.Type;
export const NotebookProposalSchema = Schema.Struct({
  id: Uuid,
  conceptId: ObjectiveIdSchema,
  evidenceIds: Schema.Array(Schema.String),
  chatMessageId: Schema.optional(Uuid),
  sourceReferences: Schema.optional(
    Schema.Array(StudySourceReferenceSchema).pipe(Schema.minItems(1), Schema.maxItems(20)),
  ),
  aiRefinementOf: Schema.optional(Uuid),
  claimId: Schema.optional(Uuid),
  proposal: CardProposalSchema,
  createdAt: Time,
  providerSessionId: Schema.optional(Uuid),
  providerAcknowledged: Schema.optional(Schema.Boolean),
  providerResolutionRequired: Schema.optional(Schema.Boolean),
  status: Schema.Literal("pending", "accepted", "discarded"),
  cardId: Schema.NullOr(AssessmentIdSchema),
});
export const NotebookSessionSchema = Schema.Struct({
  phase: Schema.Literal("idle", "active", "finished"),
  targetConceptId: Schema.NullOr(ObjectiveIdSchema),
  pendingQuestion: Schema.NullOr(TutorQuestionSchema),
  draftAnswer: Schema.optional(Schema.String.pipe(Schema.maxLength(8000))),
  draftConfidence: Schema.optional(Schema.Literal("guess", "unsure", "confident")),
  providerSessionId: Schema.optional(Uuid),
  mode: NotebookModeSchema,
  askedQuestions: Time,

  requestsUsed: Time,
  startedAt: Schema.NullOr(Time),

  skippedConceptIds: Schema.Array(ObjectiveIdSchema),
});
const NotebookShape = Schema.Struct({
  version: Schema.Literal(1),
  areaId: AreaIdSchema,
  goal: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  concepts: Schema.Array(NotebookConceptSchema).pipe(Schema.maxItems(200)),
  evidence: Schema.Array(NotebookEvidenceSchema),
  proposals: Schema.Array(NotebookProposalSchema),
  improvementChat: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String.pipe(Schema.minLength(1)),
        role: Schema.Literal("learner", "assistant"),
        content: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(8000)),
        at: Time,
      }),
    ),
  ),
  session: NotebookSessionSchema,
  coveragePlans: Schema.optional(Schema.Array(StudyCoveragePlanSchema).pipe(Schema.maxItems(200))),
  materials: Schema.optional(Schema.Array(StudyMaterialSchema).pipe(Schema.maxItems(50))),
});
export function hasConceptCycle(concepts: readonly (typeof NotebookConceptSchema.Type)[]): boolean {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const visiting = new Set<string>();
  const finished = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (finished.has(id)) return false;
    const concept = concepts.find((item) => item.id === id);
    if (!concept) return false;
    visiting.add(id);
    const cycle = [
      ...concept.prerequisiteIds,
      ...(concept.parentId === null ? [] : [concept.parentId]),
    ].some(visit);
    visiting.delete(id);
    finished.add(id);
    return cycle;
  };
  return [...byId.keys()].some(visit);
}
function proposalClaimIsValid(
  proposal: typeof NotebookProposalSchema.Type,
  plans: readonly (typeof StudyCoveragePlanSchema.Type)[],
): boolean {
  if (proposal.claimId === undefined) return true;
  return plans.some((plan) => {
    const containsClaim = plan.claims.some((claim) => claim.id === proposal.claimId);
    const hasMatchingReference = proposal.sourceReferences?.some(
      (reference) =>
        reference.materialId === plan.materialId && reference.sectionId === plan.sectionId,
    );
    return containsClaim && hasMatchingReference === true;
  });
}
function proposalRefinementIsValid(
  proposal: typeof NotebookProposalSchema.Type,
  proposals: readonly (typeof NotebookProposalSchema.Type)[],
): boolean {
  if (proposal.providerResolutionRequired !== false || proposal.chatMessageId !== undefined)
    return true;
  if ((proposal.sourceReferences?.length ?? 0) > 0) return true;
  if (proposal.aiRefinementOf === undefined) return false;
  return proposals.some(
    (original) =>
      original.id === proposal.aiRefinementOf &&
      original.status === "discarded" &&
      original.conceptId === proposal.conceptId &&
      original.evidenceIds.length > 0 &&
      JSON.stringify(original.evidenceIds) === JSON.stringify(proposal.evidenceIds),
  );
}
function proposalOriginIsValid(
  proposal: typeof NotebookProposalSchema.Type,
  notebook: typeof NotebookShape.Type,
): boolean {
  const chat =
    proposal.chatMessageId !== undefined &&
    notebook.improvementChat?.some(
      (message) => message.id === proposal.chatMessageId && message.role === "learner",
    ) === true;
  return (
    (proposal.chatMessageId === undefined || chat) &&
    (chat || proposal.evidenceIds.length > 0 || (proposal.sourceReferences?.length ?? 0) > 0)
  );
}
export const KnowledgeNotebookSchema = NotebookShape.pipe(
  Schema.filter((notebook) => {
    const ids = new Set(notebook.concepts.map((concept) => concept.id));
    const evidenceIds = new Set(notebook.evidence.map((entry) => entry.id));
    return (
      new Set((notebook.materials ?? []).map((material) => material.id)).size ===
        (notebook.materials ?? []).length &&
      (notebook.materials ?? [])
        .flatMap((material) => material.sections)
        .reduce((sum, section) => sum + section.text.length, 0) <= 2_000_000 &&
      new Set((notebook.coveragePlans ?? []).map((plan) => plan.id)).size ===
        (notebook.coveragePlans ?? []).length &&
      new Set(
        (notebook.coveragePlans ?? []).flatMap((plan) => plan.claims.map((claim) => claim.id)),
      ).size ===
        (notebook.coveragePlans ?? []).reduce((count, plan) => count + plan.claims.length, 0) &&
      (notebook.coveragePlans ?? []).every((plan) =>
        plan.claims.every((claim) =>
          claim.sourceReferences.every((reference) => {
            const section = notebook.materials
              ?.find((material) => material.id === plan.materialId)
              ?.sections.find((item) => item.id === plan.sectionId);
            return (
              reference.materialId === plan.materialId &&
              reference.sectionId === plan.sectionId &&
              section !== undefined &&
              section.pageNumber === reference.pageNumber &&
              section.text.includes(reference.quote)
            );
          }),
        ),
      ) &&
      ids.size === notebook.concepts.length &&
      !hasConceptCycle(notebook.concepts) &&
      evidenceIds.size === notebook.evidence.length &&
      new Set(notebook.proposals.map((proposal) => proposal.id)).size ===
        notebook.proposals.length &&
      notebook.concepts.every(
        (concept) =>
          (concept.parentId === null ||
            (ids.has(concept.parentId) && concept.parentId !== concept.id)) &&
          concept.prerequisiteIds.every((id) => ids.has(id) && id !== concept.id),
      ) &&
      notebook.evidence.every(
        (entry) =>
          ids.has(entry.conceptId) &&
          (entry.kind !== "tutor" ||
            entry.evaluation.objectiveId ===
              (notebook.concepts.find((concept) => concept.id === entry.conceptId)?.objectiveId ??
                null)) &&
          (entry.kind !== "review" || entry.reviewEvent.areaId === notebook.areaId),
      ) &&
      notebook.proposals.every(
        (proposal) =>
          proposalRefinementIsValid(proposal, notebook.proposals) &&
          proposalOriginIsValid(proposal, notebook) &&
          (proposal.sourceReferences ?? []).every((reference) => {
            const material = notebook.materials?.find((item) => item.id === reference.materialId);
            const section = material?.sections.find((item) => item.id === reference.sectionId);
            return (
              section !== undefined &&
              section.pageNumber === reference.pageNumber &&
              section.text.includes(reference.quote)
            );
          }) &&
          proposalClaimIsValid(proposal, notebook.coveragePlans ?? []) &&
          ids.has(proposal.conceptId) &&
          proposal.proposal.objectiveId ===
            (notebook.concepts.find((concept) => concept.id === proposal.conceptId)?.objectiveId ??
              null) &&
          proposal.evidenceIds.every((id) =>
            notebook.evidence.some(
              (entry) => entry.id === id && entry.conceptId === proposal.conceptId,
            ),
          ) &&
          (proposal.status === "accepted" ? proposal.cardId !== null : proposal.cardId === null),
      ) &&
      (notebook.session.targetConceptId === null || ids.has(notebook.session.targetConceptId)) &&
      (notebook.session.pendingQuestion === null ||
        (notebook.session.targetConceptId !== null &&
          notebook.session.pendingQuestion.objectiveId ===
            (notebook.concepts.find((concept) => concept.id === notebook.session.targetConceptId)
              ?.objectiveId ?? null))) &&
      notebook.session.skippedConceptIds.every((id) => ids.has(id))
    );
  }),
);
export type KnowledgeNotebook = typeof KnowledgeNotebookSchema.Type;
export type NotebookConcept = typeof NotebookConceptSchema.Type;
export type NotebookProposal = typeof NotebookProposalSchema.Type;
export type NotebookSession = typeof NotebookSessionSchema.Type;
export type NotebookFailure = {
  readonly _tag: "NotebookFailure";
  readonly reason:
    | "invalid-input"
    | "invalid-notebook"
    | "session-inactive"
    | "budget-exhausted"
    | "pending-question"
    | "missing-question"
    | "duplicate-evidence"
    | "proposal-conflict"
    | "duplicate-card";
  readonly message: string;
};
export const failure = (reason: NotebookFailure["reason"], message: string): NotebookFailure => ({
  _tag: "NotebookFailure",
  reason,
  message,
});
export const read = (input: unknown) =>
  Schema.decodeUnknown(KnowledgeNotebookSchema)(input).pipe(
    Effect.mapError(() =>
      failure(
        "invalid-notebook",
        "The saved knowledge notebook is invalid. Preserve it before recovery.",
      ),
    ),
  );
export const validate = <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
  Schema.decodeUnknown(schema)(input).pipe(
    Effect.mapError(() => failure("invalid-input", "The notebook input is invalid.")),
  );
export const commit = (notebook: KnowledgeNotebook) => read(notebook);
