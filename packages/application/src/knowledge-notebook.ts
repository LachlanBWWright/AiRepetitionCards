import { Effect, Schema } from "effect";
import { normalizeReviewTimestamp } from "@recall/contracts";
import {
  KnowledgeAreaSchema,
  ObjectiveIdSchema,
  AreaIdSchema,
  AssessmentIdSchema,
  ReviewEventSchema,
} from "@recall/domain";
import { AnswerEvaluationSchema, CardProposalSchema, TutorQuestionSchema } from "@recall/ai-core";

const Uuid = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
const Time = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.filter(Number.isSafeInteger),
  Schema.lessThanOrEqualTo(8_640_000_000_000_000),
);
const Text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000));
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
  maxQuestions: Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
  maxRequests: Schema.Number.pipe(Schema.int(), Schema.between(1, 500)),
  requestsUsed: Time,
  startedAt: Schema.NullOr(Time),
  maximumDurationMs: Schema.Number.pipe(Schema.int(), Schema.between(60_000, 86_400_000)),
  skippedConceptIds: Schema.Array(ObjectiveIdSchema),
});
const NotebookShape = Schema.Struct({
  version: Schema.Literal(1),
  areaId: AreaIdSchema,
  goal: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  concepts: Schema.Array(NotebookConceptSchema).pipe(Schema.maxItems(200)),
  evidence: Schema.Array(NotebookEvidenceSchema),
  proposals: Schema.Array(NotebookProposalSchema),
  session: NotebookSessionSchema,
  coveragePlans: Schema.optional(Schema.Array(StudyCoveragePlanSchema).pipe(Schema.maxItems(200))),
  materials: Schema.optional(Schema.Array(StudyMaterialSchema).pipe(Schema.maxItems(50))),
});
function hasConceptCycle(concepts: readonly (typeof NotebookConceptSchema.Type)[]): boolean {
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
          (proposal.providerResolutionRequired !== false ||
            (proposal.sourceReferences?.length ?? 0) > 0 ||
            (proposal.aiRefinementOf !== undefined &&
              notebook.proposals.some(
                (original) =>
                  original.id === proposal.aiRefinementOf &&
                  original.status === "discarded" &&
                  original.conceptId === proposal.conceptId &&
                  original.evidenceIds.length > 0 &&
                  JSON.stringify(original.evidenceIds) === JSON.stringify(proposal.evidenceIds),
              ))) &&
          (proposal.evidenceIds.length > 0 || (proposal.sourceReferences?.length ?? 0) > 0) &&
          (proposal.sourceReferences ?? []).every((reference) => {
            const material = notebook.materials?.find((item) => item.id === reference.materialId);
            const section = material?.sections.find((item) => item.id === reference.sectionId);
            return (
              section !== undefined &&
              section.pageNumber === reference.pageNumber &&
              section.text.includes(reference.quote)
            );
          }) &&
          (proposal.claimId === undefined ||
            (notebook.coveragePlans ?? []).some(
              (plan) =>
                plan.claims.some((claim) => claim.id === proposal.claimId) &&
                proposal.sourceReferences?.some(
                  (reference) =>
                    reference.materialId === plan.materialId &&
                    reference.sectionId === plan.sectionId,
                ),
            )) &&
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
      notebook.session.skippedConceptIds.every((id) => ids.has(id)) &&
      notebook.session.requestsUsed <= notebook.session.maxRequests &&
      notebook.session.askedQuestions <= notebook.session.maxQuestions
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
const failure = (reason: NotebookFailure["reason"], message: string): NotebookFailure => ({
  _tag: "NotebookFailure",
  reason,
  message,
});
const read = (input: unknown) =>
  Schema.decodeUnknown(KnowledgeNotebookSchema)(input).pipe(
    Effect.mapError(() =>
      failure(
        "invalid-notebook",
        "The saved knowledge notebook is invalid. Preserve it before recovery.",
      ),
    ),
  );
const validate = <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
  Schema.decodeUnknown(schema)(input).pipe(
    Effect.mapError(() => failure("invalid-input", "The notebook input is invalid.")),
  );
const commit = (notebook: KnowledgeNotebook) => read(notebook);

export function seedKnowledgeNotebook(
  areaInput: unknown,
  goalInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const area = yield* validate(KnowledgeAreaSchema, areaInput);
    const goal = yield* validate(
      Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
      goalInput,
    );
    return yield* commit({
      version: 1,
      areaId: area.id,
      goal,
      concepts: area.objectives.length
        ? area.objectives.map((objective) => ({
            ...objective,
            objectiveId: objective.id,
            parentId: null,
          }))
        : [
            {
              id: yield* validate(ObjectiveIdSchema, area.id),
              title: area.title,
              description: area.description,
              parentId: null,
              objectiveId: null,
              prerequisiteIds: [],
            },
          ],
      evidence: [],
      proposals: [],
      session: {
        phase: "idle",
        targetConceptId: null,
        pendingQuestion: null,
        draftAnswer: "",
        draftConfidence: "unsure",
        mode: "diagnostic",
        askedQuestions: 0,
        maxQuestions: 12,
        maxRequests: 40,
        requestsUsed: 0,
        startedAt: null,
        maximumDurationMs: 1_800_000,
        skippedConceptIds: [],
      },
    });
  });
}
export function beginNotebookSession(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const settings = yield* validate(
      Schema.Struct({
        startedAt: Time,
        maxQuestions: Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
        maxRequests: Schema.Number.pipe(Schema.int(), Schema.between(1, 500)),
        maximumDurationMs: Schema.Number.pipe(Schema.int(), Schema.between(60_000, 86_400_000)),
      }),
      input,
    );
    if (notebook.session.phase === "active")
      return yield* Effect.fail(
        failure(
          "pending-question",
          "Resume or finish the current investigation before starting another.",
        ),
      );
    return yield* commit({
      ...notebook,
      session: {
        ...notebook.session,
        ...settings,
        phase: "active",
        targetConceptId: null,
        pendingQuestion: null,
        mode: "diagnostic",
        draftAnswer: "",
        draftConfidence: "unsure",
        askedQuestions: 0,
        requestsUsed: 0,
        skippedConceptIds: [],
      },
    });
  });
}
/** Save unfinished learner input without creating assessment evidence or spending AI usage. */
export function updateNotebookAnswerDraft(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const draft = yield* validate(
      Schema.Struct({
        answer: Schema.String.pipe(Schema.maxLength(8000)),
        learnerConfidence: Schema.Literal("guess", "unsure", "confident"),
      }),
      input,
    );
    if (!notebook.session.pendingQuestion)
      return yield* Effect.fail(
        failure("missing-question", "Ask a question before saving an answer draft."),
      );
    return yield* commit({
      ...notebook,
      session: {
        ...notebook.session,
        draftAnswer: draft.answer,
        draftConfidence: draft.learnerConfidence,
      },
    });
  });
}

export const NotebookAssessmentSchema = Schema.Struct({
  conceptId: ObjectiveIdSchema,
  status: Schema.Literal("unassessed", "uncertain", "demonstrated", "needs-reinforcement"),
  evidenceCount: Time,
  reason: Text,
});
export type NotebookAssessment = typeof NotebookAssessmentSchema.Type;
function assessments(notebook: KnowledgeNotebook): readonly NotebookAssessment[] {
  return notebook.concepts.map((concept) => {
    const entries = notebook.evidence
      .filter((entry) => entry.conceptId === concept.id)
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const latest = entries.at(-1);
    const negative = (entry: NotebookEvidence) =>
      entry.kind === "review"
        ? entry.reviewEvent.rating === "again" || entry.reviewEvent.rating === "hard"
        : entry.evaluation.result === "incorrect" || entry.evaluation.result === "partial";
    const positive = (entry: NotebookEvidence) =>
      entry.kind === "review"
        ? entry.reviewEvent.rating === "good" || entry.reviewEvent.rating === "easy"
        : entry.evaluation.result === "mastered" &&
          entry.evaluation.confidence >= 0.7 &&
          entry.learnerConfidence !== "guess";
    const lastFailure = entries.map(negative).lastIndexOf(true);
    const successes = entries
      .slice(lastFailure + 1)
      .filter((entry) => entry.kind === "tutor" && positive(entry));
    const distinctPrompts = new Set(
      successes.map((entry) =>
        entry.kind === "tutor" ? entry.question.trim().toLocaleLowerCase("en-US") : "",
      ),
    );
    const hasTransferEvidence = successes.some(
      (entry) =>
        entry.kind === "tutor" &&
        entry.investigationMode !== undefined &&
        ["explain", "apply", "vary", "predict"].includes(entry.investigationMode),
    );
    const status = !latest
      ? "unassessed"
      : negative(latest)
        ? "needs-reinforcement"
        : successes.length >= 2 &&
            distinctPrompts.size >= 2 &&
            hasTransferEvidence &&
            positive(latest)
          ? "demonstrated"
          : "uncertain";
    return {
      conceptId: concept.id,
      status,
      evidenceCount: entries.length,
      reason:
        status === "unassessed"
          ? "No observations yet."
          : status === "needs-reinforcement"
            ? "The latest observation exposed a gap; revisit this concept."
            : status === "demonstrated"
              ? "Distinct tutor answers, including explanation or application, support understanding; recall alone does not establish it and future failures can reopen it."
              : "Evidence is limited or tentative; one answer does not establish understanding.",
    };
  });
}
export function deriveNotebookAssessments(
  input: unknown,
): Effect.Effect<readonly NotebookAssessment[], NotebookFailure> {
  return read(input).pipe(Effect.map(assessments));
}
const exhausted = (notebook: KnowledgeNotebook, now: number) =>
  notebook.session.requestsUsed >= notebook.session.maxRequests ||
  (notebook.session.askedQuestions >= notebook.session.maxQuestions &&
    notebook.session.pendingQuestion === null) ||
  (notebook.session.startedAt !== null &&
    now - notebook.session.startedAt >= notebook.session.maximumDurationMs);
export function reserveNotebookRequest(
  notebookInput: unknown,
  nowInput: unknown,
  task: "question" | "evaluate" | "propose-card" = "question",
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const now = yield* validate(Time, nowInput);
    if (
      notebook.session.phase !== "active" &&
      !(task === "propose-card" && notebook.session.phase === "finished")
    )
      return yield* Effect.fail(
        failure("session-inactive", "Start or resume an investigation first."),
      );
    if (task === "evaluate" && notebook.session.pendingQuestion === null)
      return yield* Effect.fail(
        failure("missing-question", "There is no pending question to evaluate."),
      );
    if (
      notebook.session.requestsUsed >= notebook.session.maxRequests ||
      (task === "question" && notebook.session.askedQuestions >= notebook.session.maxQuestions) ||
      (task === "question" &&
        notebook.session.startedAt !== null &&
        now - notebook.session.startedAt >= notebook.session.maximumDurationMs)
    )
      return yield* Effect.fail(
        failure(
          "budget-exhausted",
          "This investigation reached its question, request, or time budget. Finish it and keep unresolved concepts for later.",
        ),
      );
    return yield* commit({
      ...notebook,
      session: { ...notebook.session, requestsUsed: notebook.session.requestsUsed + 1 },
    });
  });
}
export const admitNotebookRequest = reserveNotebookRequest;
export type NotebookTarget = {
  readonly conceptId: NotebookConcept["id"];
  readonly mode: NotebookMode;
  readonly reason: string;
};
export function selectNotebookTarget(
  notebookInput: unknown,
  nowInput: unknown,
): Effect.Effect<NotebookTarget | null, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const now = yield* validate(Time, nowInput);
    if (notebook.session.phase !== "active" || exhausted(notebook, now)) return null;
    if (notebook.session.pendingQuestion && notebook.session.targetConceptId !== null)
      return {
        conceptId: notebook.session.targetConceptId,
        mode: notebook.session.mode,
        reason: "Resume the unanswered question.",
      };
    const available = assessments(notebook).filter(
      (item) => !notebook.session.skippedConceptIds.includes(item.conceptId),
    );
    const gap = available.find((item) => item.status === "needs-reinforcement");
    if (gap) {
      const concept = notebook.concepts.find((item) => item.id === gap.conceptId);
      const prerequisite = concept?.prerequisiteIds.find((id) =>
        available.some((item) => item.conceptId === id && item.status !== "demonstrated"),
      );
      if (prerequisite)
        return {
          conceptId: prerequisite,
          mode: "clarify",
          reason: "Check a prerequisite implicated by a gap.",
        };
    }
    const target = notebook.session.targetConceptId;
    if (
      target &&
      notebook.session.mode !== "diagnostic" &&
      !notebook.session.skippedConceptIds.includes(target)
    )
      return {
        conceptId: target,
        mode: notebook.session.mode,
        reason: "Continue the deliberate follow-up.",
      };
    const next =
      available.find((item) => item.status === "unassessed") ??
      gap ??
      available.find((item) => item.status === "uncertain");
    return next
      ? {
          conceptId: next.conceptId,
          mode: next.status === "unassessed" ? "diagnostic" : "revisit",
          reason: next.reason,
        }
      : null;
  });
}
export function setNotebookQuestion(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(
      Schema.Struct({
        question: TutorQuestionSchema,
        conceptId: Schema.optional(ObjectiveIdSchema),
        mode: Schema.optional(NotebookModeSchema),
        now: Time,
        providerSessionId: Schema.optional(Uuid),
      }),
      input,
    );
    if (notebook.session.phase !== "active")
      return yield* Effect.fail(failure("session-inactive", "This investigation is not active."));
    if (notebook.session.pendingQuestion && notebook.session.targetConceptId !== null)
      return yield* Effect.fail(
        failure("pending-question", "Answer or skip the existing question before replacing it."),
      );
    if (notebook.session.askedQuestions >= notebook.session.maxQuestions)
      return yield* Effect.fail(
        failure("budget-exhausted", "The investigation question budget is complete."),
      );
    const conceptId =
      value.conceptId ?? (yield* validate(ObjectiveIdSchema, value.question.objectiveId));
    if (
      value.question.objectiveId !==
      (notebook.concepts.find((concept) => concept.id === conceptId)?.objectiveId ?? null)
    )
      return yield* Effect.fail(
        failure("invalid-input", "The question belongs to another concept."),
      );
    return yield* commit({
      ...notebook,
      session: {
        ...notebook.session,
        ...(value.providerSessionId === undefined
          ? {}
          : { providerSessionId: value.providerSessionId }),
        targetConceptId: conceptId,
        mode: value.mode ?? notebook.session.mode,
        pendingQuestion: value.question,
        draftAnswer: "",
        draftConfidence: "unsure",
        askedQuestions: notebook.session.askedQuestions + 1,
      },
    });
  });
}
export function appendNotebookAnswer(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(
      Schema.Struct({
        id: Uuid,
        answer: Schema.String.pipe(Schema.maxLength(8000)),
        learnerConfidence: Schema.Literal("guess", "unsure", "confident"),
        evaluation: AnswerEvaluationSchema,
        at: Time,
        providerSessionId: Schema.optional(Uuid),
      }),
      input,
    );
    const question = notebook.session.pendingQuestion;
    if (!question)
      return yield* Effect.fail(
        failure("missing-question", "There is no pending question to evaluate."),
      );
    if (notebook.evidence.some((entry) => entry.id === value.id))
      return yield* Effect.fail(
        failure("duplicate-evidence", "This observation has already been recorded."),
      );
    const conceptId = notebook.session.targetConceptId;
    if (conceptId === null)
      return yield* Effect.fail(
        failure("missing-question", "The pending question has no concept."),
      );
    if (value.evaluation.objectiveId !== question.objectiveId)
      return yield* Effect.fail(
        failure("invalid-input", "The evaluation belongs to another concept."),
      );
    const modes: readonly NotebookMode[] = [
      "diagnostic",
      "clarify",
      "predict",
      "vary",
      "explain",
      "apply",
      "revisit",
    ];
    const mode =
      value.evaluation.result === "incorrect" || value.evaluation.result === "partial"
        ? "clarify"
        : notebook.session.mode === "diagnostic" ||
            notebook.session.mode === "apply" ||
            notebook.session.mode === "revisit"
          ? "diagnostic"
          : (modes[Math.min(modes.indexOf(notebook.session.mode) + 1, modes.length - 1)] ??
            "revisit");
    return yield* commit({
      ...notebook,
      evidence: [
        ...notebook.evidence,
        {
          ...value,
          kind: "tutor",
          conceptId,
          question: question.question,
          investigationMode: notebook.session.mode,
          linkedCardIds: [],
        },
      ],
      session: {
        ...notebook.session,
        pendingQuestion: null,
        draftAnswer: "",
        draftConfidence: "unsure",
        mode,
        targetConceptId: conceptId,
      },
    });
  });
}
export function controlNotebookSession(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(
      Schema.Struct({ action: Schema.Literal("deeper", "explain", "skip", "finish"), now: Time }),
      input,
    );
    if (notebook.session.phase !== "active")
      return yield* Effect.fail(failure("session-inactive", "This investigation is not active."));
    const target = notebook.session.targetConceptId;
    return yield* commit({
      ...notebook,
      session: {
        ...notebook.session,
        phase: value.action === "finish" ? "finished" : "active",
        pendingQuestion: null,
        draftAnswer: "",
        draftConfidence: "unsure",
        targetConceptId: value.action === "skip" || value.action === "finish" ? null : target,
        mode:
          value.action === "deeper"
            ? "apply"
            : value.action === "explain"
              ? "explain"
              : "diagnostic",
        skippedConceptIds:
          value.action === "skip" && target !== null
            ? [...new Set([...notebook.session.skippedConceptIds, target])]
            : notebook.session.skippedConceptIds,
      },
    });
  });
}
export function appendNotebookReviewEvidence(
  notebookInput: unknown,
  areaInput: unknown,
  eventsInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const area = yield* validate(KnowledgeAreaSchema, areaInput);
    const events = yield* validate(Schema.Array(ReviewEventSchema), eventsInput);
    if (area.id !== notebook.areaId)
      return yield* Effect.fail(
        failure("invalid-input", "Review evidence belongs to another area."),
      );
    let evidence = notebook.evidence;
    for (const event of events) {
      if (event.areaId !== notebook.areaId) continue;
      const card = area.cards.find((item) => item.id === event.cardId);
      if (!card) continue;
      const normalizedTime = normalizeReviewTimestamp(event.effectiveReviewedAt ?? event.ratedAt);
      const at = normalizedTime === null ? Number.NaN : Date.parse(normalizedTime);
      if (!Number.isSafeInteger(at) || at < 0)
        return yield* Effect.fail(failure("invalid-input", "The review evidence time is invalid."));
      for (const conceptId of [
        ...new Set([
          ...card.objectiveIds,
          ...notebook.proposals
            .filter((proposal) => proposal.status === "accepted" && proposal.cardId === card.id)
            .map((proposal) => proposal.conceptId),
          ...notebook.evidence
            .filter((entry) => entry.linkedCardIds.includes(card.id))
            .map((entry) => entry.conceptId),
        ]),
      ]) {
        if (!notebook.concepts.some((concept) => concept.id === conceptId)) continue;
        const id = `review:${event.id}:${conceptId}`;
        if (evidence.some((entry) => entry.id === id)) continue;
        evidence = [
          ...evidence,
          { kind: "review", id, conceptId, reviewEvent: event, at, linkedCardIds: [card.id] },
        ];
      }
    }
    return yield* commit({ ...notebook, evidence });
  });
}
const normalized = (text: string) =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
export function addNotebookProposal(
  notebookInput: unknown,
  input: unknown,
  existingCardsInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(
      Schema.Struct({
        id: Uuid,
        conceptId: ObjectiveIdSchema,
        evidenceIds: Schema.Array(Schema.String),
        sourceReferences: Schema.optional(
          Schema.Array(StudySourceReferenceSchema).pipe(Schema.minItems(1), Schema.maxItems(20)),
        ),
        aiRefinementOf: Schema.optional(Uuid),
        claimId: Schema.optional(Uuid),
        proposal: CardProposalSchema,
        createdAt: Time,
        providerSessionId: Schema.optional(Uuid),
        providerResolutionRequired: Schema.optional(Schema.Boolean),
      }),
      input,
    );
    const cards = yield* validate(
      Schema.Array(
        Schema.Struct({
          front: Schema.optional(Schema.String),
          back: Schema.optional(Schema.String),
          text: Schema.optional(Schema.String),
        }),
      ),
      existingCardsInput,
    );
    if (notebook.proposals.some((proposal) => proposal.id === value.id))
      return yield* Effect.fail(
        failure("proposal-conflict", "This card proposal is already recorded."),
      );
    const duplicate = (front: string, back: string) =>
      normalized(front) === normalized(value.proposal.front) &&
      normalized(back) === normalized(value.proposal.back);
    if (
      cards.some(
        (card) =>
          card.front !== undefined && card.back !== undefined && duplicate(card.front, card.back),
      ) ||
      notebook.proposals.some(
        (proposal) =>
          proposal.status !== "discarded" &&
          duplicate(proposal.proposal.front, proposal.proposal.back),
      )
    )
      return yield* Effect.fail(
        failure(
          "duplicate-card",
          "An equivalent card or pending proposal already exists. Review that card instead.",
        ),
      );
    return yield* commit({
      ...notebook,
      proposals: [
        ...notebook.proposals,
        { ...value, status: "pending", providerAcknowledged: false, cardId: null },
      ],
    });
  });
}
export function resolveNotebookProposal(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(
      Schema.Struct({
        id: Uuid,
        status: Schema.Literal("accepted", "discarded"),
        cardId: Schema.optional(AssessmentIdSchema),
        proposal: Schema.optional(CardProposalSchema),
      }),
      input,
    );
    const proposal = notebook.proposals.find((item) => item.id === value.id);
    const cardId = value.status === "accepted" ? (value.cardId ?? null) : null;
    if (!proposal || (value.status === "accepted" && cardId === null))
      return yield* Effect.fail(
        failure(
          "proposal-conflict",
          "Approve and durably save a card before linking it to the notebook.",
        ),
      );
    if (proposal.status !== "pending") {
      if (
        proposal.status === value.status &&
        proposal.cardId === cardId &&
        (value.proposal === undefined ||
          JSON.stringify(value.proposal) === JSON.stringify(proposal.proposal))
      )
        return notebook;
      return yield* Effect.fail(
        failure("proposal-conflict", "This proposal was already resolved differently."),
      );
    }
    return yield* commit({
      ...notebook,
      proposals: notebook.proposals.map((item) =>
        item.id === value.id
          ? {
              ...item,
              proposal: value.proposal ?? item.proposal,
              status: value.status,
              cardId,
              providerAcknowledged: false,
            }
          : item,
      ),
      evidence: notebook.evidence.map((entry) =>
        cardId !== null && proposal.evidenceIds.includes(entry.id)
          ? { ...entry, linkedCardIds: [...new Set([...entry.linkedCardIds, cardId])] }
          : entry,
      ),
    });
  });
}

/** Concepts are added only after learner approval; retries with the same contents are safe. */
export function addNotebookConcepts(
  notebookInput: unknown,
  input: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const concepts = yield* validate(
      Schema.Array(NotebookConceptSchema).pipe(Schema.minItems(1), Schema.maxItems(200)),
      input,
    );
    let next = notebook.concepts;
    for (const concept of concepts) {
      const existing = next.find((item) => item.id === concept.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(concept))
          return yield* Effect.fail(
            failure("invalid-input", "This concept identity already has different content."),
          );
      } else next = [...next, concept];
    }
    if (hasConceptCycle(next))
      return yield* Effect.fail(
        failure("invalid-input", "Concept hierarchy and prerequisites cannot contain cycles."),
      );
    return yield* commit({ ...notebook, concepts: next });
  });
}
export function markNotebookProposalAcknowledged(
  notebookInput: unknown,
  idInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const id = yield* validate(Uuid, idInput);
    const proposal = notebook.proposals.find((item) => item.id === id);
    if (!proposal || proposal.status === "pending")
      return yield* Effect.fail(
        failure(
          "proposal-conflict",
          "Resolve the proposal before recording provider acknowledgment.",
        ),
      );
    return yield* commit({
      ...notebook,
      proposals: notebook.proposals.map((item) =>
        item.id === id ? { ...item, providerAcknowledged: true } : item,
      ),
    });
  });
}

/** Save validated pending edits explicitly; approved card content remains immutable. */
export function editNotebookProposal(
  notebookInput: unknown,
  input: unknown,
  existingCardsInput: unknown = [],
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* validate(Schema.Struct({ id: Uuid, proposal: CardProposalSchema }), input);
    const existing = notebook.proposals.find((proposal) => proposal.id === value.id);
    if (!existing || existing.status !== "pending")
      return yield* Effect.fail(
        failure("proposal-conflict", "Only pending proposals can be edited."),
      );
    const withoutProposal = {
      ...notebook,
      proposals: notebook.proposals.filter((proposal) => proposal.id !== value.id),
    };
    yield* addNotebookProposal(
      withoutProposal,
      { ...existing, proposal: value.proposal },
      existingCardsInput,
    );
    return yield* commit({
      ...notebook,
      proposals: notebook.proposals.map((proposal) =>
        proposal.id === value.id ? { ...proposal, proposal: value.proposal } : proposal,
      ),
    });
  });
}
