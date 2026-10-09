import { Effect, Schema } from "effect";
import { CardProposalSchema } from "@recall/ai-core";
import { ObjectiveIdSchema } from "@recall/domain";
import {
  KnowledgeNotebookSchema,
  StudyMaterialSchema,
  StudySourceReferenceSchema,
  addNotebookProposal,
  type KnowledgeNotebook,
  type NotebookFailure,
  type StudyMaterial,
  type StudyMaterialSection,
} from "./knowledge-notebook";

const Uuid = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);

/** Prefer selected passages with the fewest saved proposals, retaining source order on ties. */
export function selectNextStudyMaterialSection(
  notebook: KnowledgeNotebook,
  materialId?: string,
): { readonly material: StudyMaterial; readonly section: StudyMaterialSection } | null {
  const sources = (notebook.materials ?? []).flatMap((material) =>
    materialId === undefined || material.id === materialId
      ? material.sections
          .filter((section) => section.selected)
          .map((section) => ({ material, section }))
      : [],
  );
  const attempts = (source: {
    readonly material: StudyMaterial;
    readonly section: StudyMaterialSection;
  }) =>
    notebook.proposals.filter((proposal) =>
      proposal.sourceReferences?.some(
        (reference) =>
          reference.materialId === source.material.id && reference.sectionId === source.section.id,
      ),
    ).length;
  return sources.sort((left, right) => attempts(left) - attempts(right))[0] ?? null;
}
const Time = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.filter(Number.isSafeInteger),
  Schema.lessThanOrEqualTo(8_640_000_000_000_000),
);
const fail = (reason: NotebookFailure["reason"], message: string): NotebookFailure => ({
  _tag: "NotebookFailure",
  reason,
  message,
});
const decode = <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
  Schema.decodeUnknown(schema)(input).pipe(
    Effect.mapError(() =>
      fail("invalid-input", "The study material input is invalid or exceeds local library limits."),
    ),
  );
const read = (input: unknown) =>
  Schema.decodeUnknown(KnowledgeNotebookSchema)(input).pipe(
    Effect.mapError(() =>
      fail(
        "invalid-notebook",
        "The saved knowledge notebook is invalid. Preserve it before recovery.",
      ),
    ),
  );

/** Import only after the user has reviewed extraction. Originals belong to platform storage adapters. */
export function addNotebookMaterial(
  notebookInput: unknown,
  materialInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const material = yield* decode(StudyMaterialSchema, materialInput);
    if (notebook.materials?.some((existing) => existing.id === material.id))
      return yield* Effect.fail(fail("invalid-input", "This material identity already exists."));
    return yield* decode(KnowledgeNotebookSchema, {
      ...notebook,
      materials: [...(notebook.materials ?? []), material],
    });
  });
}

/** Corrections cannot invalidate saved source citations; import a revised copy instead. */
export function updateNotebookMaterial(
  notebookInput: unknown,
  materialInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const material = yield* decode(StudyMaterialSchema, materialInput);
    const existing = notebook.materials?.find((item) => item.id === material.id);
    if (!existing)
      return yield* Effect.fail(
        fail("invalid-input", "Select an imported material before editing it."),
      );
    if (material.format !== existing.format || material.importedAt !== existing.importedAt)
      return yield* Effect.fail(
        fail("invalid-input", "The original import format and time cannot be changed."),
      );
    const next = {
      ...notebook,
      materials: (notebook.materials ?? []).map((item) =>
        item.id === material.id ? material : item,
      ),
    };
    return yield* Schema.decodeUnknown(KnowledgeNotebookSchema)(next).pipe(
      Effect.mapError(() =>
        fail(
          "proposal-conflict",
          "This correction would invalidate saved source references or exceed library limits. Preserve the cited passage or import a revised copy.",
        ),
      ),
    );
  });
}

export function removeNotebookMaterial(
  notebookInput: unknown,
  materialIdInput: unknown,
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const id = yield* decode(Uuid, materialIdInput);
    if (
      (notebook.coveragePlans ?? []).some((plan) => plan.materialId === id) ||
      notebook.proposals.some((proposal) =>
        proposal.sourceReferences?.some((reference) => reference.materialId === id),
      )
    )
      return yield* Effect.fail(
        fail(
          "proposal-conflict",
          "This material supports saved card proposals. Keep it to preserve their source references, or clear the notebook explicitly.",
        ),
      );
    return yield* read({
      ...notebook,
      materials: (notebook.materials ?? []).filter((material) => material.id !== id),
    });
  });
}

export const MaterialCardProposalInputSchema = Schema.Struct({
  id: Uuid,
  conceptId: ObjectiveIdSchema,
  proposal: CardProposalSchema,
  sourceReferences: Schema.Array(StudySourceReferenceSchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(20),
  ),
  claimId: Schema.optional(Uuid),
  createdAt: Time,
  providerSessionId: Schema.optional(Uuid),
  providerResolutionRequired: Schema.optional(Schema.Boolean),
});

/** Provider references must point at actual selected passages; they are not learner evidence. */
export function addMaterialCardProposals(
  notebookInput: unknown,
  input: unknown,
  existingCardsInput: unknown = [],
): Effect.Effect<KnowledgeNotebook, NotebookFailure> {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const batch = yield* decode(
      Schema.Struct({
        materialId: Uuid,
        sectionId: Uuid,
        proposals: Schema.Array(MaterialCardProposalInputSchema).pipe(
          Schema.minItems(1),
          Schema.maxItems(20),
        ),
      }),
      input,
    );
    const material = notebook.materials?.find((item) => item.id === batch.materialId);
    const section = material?.sections.find((item) => item.id === batch.sectionId);
    if (!section?.selected)
      return yield* Effect.fail(
        fail("invalid-input", "Select the source section before generating cards."),
      );
    let next = notebook;
    for (const proposal of batch.proposals) {
      if (
        !proposal.sourceReferences.some(
          (reference) =>
            reference.materialId === batch.materialId && reference.sectionId === batch.sectionId,
        )
      )
        return yield* Effect.fail(
          fail("invalid-input", "Each card must cite the selected batch section."),
        );
      if (
        !proposal.sourceReferences.every((reference) => {
          const citedMaterial = notebook.materials?.find(
            (item) => item.id === reference.materialId,
          );
          const citedSection = citedMaterial?.sections.find(
            (item) => item.id === reference.sectionId,
          );
          return (
            citedSection?.selected === true &&
            citedSection.pageNumber === reference.pageNumber &&
            citedSection.text.includes(reference.quote)
          );
        })
      )
        return yield* Effect.fail(
          fail(
            "invalid-input",
            "The provider cited an unavailable, unselected, or altered passage.",
          ),
        );
      next = yield* addNotebookProposal(next, { ...proposal, evidenceIds: [] }, existingCardsInput);
    }
    return next;
  });
}

export type StudyMaterialCoverage = {
  readonly materialId: string;
  readonly sectionId: string;
  readonly status: "unprocessed" | "proposed" | "approved";
  readonly pendingCards: number;
  readonly approvedCards: number;
  readonly discardedCards: number;
};

/** Status records card activity, not complete coverage or demonstrated understanding. */
export function deriveStudyMaterialCoverage(
  notebookInput: unknown,
): Effect.Effect<readonly StudyMaterialCoverage[], NotebookFailure> {
  return read(notebookInput).pipe(
    Effect.map((notebook) =>
      (notebook.materials ?? []).flatMap((material) =>
        material.sections.map((section): StudyMaterialCoverage => {
          const proposals = notebook.proposals.filter((proposal) =>
            proposal.sourceReferences?.some(
              (reference) =>
                reference.materialId === material.id && reference.sectionId === section.id,
            ),
          );
          const pendingCards = proposals.filter((proposal) => proposal.status === "pending").length;
          const approvedCards = proposals.filter(
            (proposal) => proposal.status === "accepted",
          ).length;
          const discardedCards = proposals.filter(
            (proposal) => proposal.status === "discarded",
          ).length;
          return {
            materialId: material.id,
            sectionId: section.id,
            pendingCards,
            approvedCards,
            discardedCards,
            status: approvedCards > 0 ? "approved" : pendingCards > 0 ? "proposed" : "unprocessed",
          };
        }),
      ),
    ),
  );
}
