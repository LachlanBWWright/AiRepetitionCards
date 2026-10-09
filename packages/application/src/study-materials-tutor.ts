import { Effect, Schema } from "effect";
import { TutorContextSchema, TutorActionResponseSchema } from "@recall/ai-core";
import { ObjectiveIdSchema } from "@recall/domain";
import {
  KnowledgeNotebookSchema,
  reserveNotebookRequest,
  type KnowledgeNotebook,
} from "./knowledge-notebook";
import { addMaterialCardProposals } from "./study-materials";
import { createTutorApi, tutorApiFailureMessage } from "./tutor-api";
import type { NotebookTutorFailure } from "./knowledge-notebook-tutor";

const GenerateInput = Schema.Struct({
  materialId: Schema.UUID,
  sectionId: Schema.UUID,
  conceptId: ObjectiveIdSchema,
  claimId: Schema.optional(Schema.UUID),
  depth: Schema.Literal("overview", "standard", "detailed"),
  goal: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000))),
});
const fail = (message: string, notebook: KnowledgeNotebook | null): NotebookTutorFailure => ({
  _tag: "NotebookTutorFailure",
  message,
  notebook,
});

/** One source-grounded card per admitted request; callers can build resumable batches.
 * No extracted passage or generation result establishes learner mastery. */
export function createStudyMaterialsTutor(
  api: Pick<ReturnType<typeof createTutorApi>, "request">,
  persistBeforeRequest: (
    notebook: KnowledgeNotebook,
  ) => Effect.Effect<void, { readonly message: string }>,
) {
  const persist = (notebook: KnowledgeNotebook) =>
    persistBeforeRequest(notebook).pipe(Effect.mapError((error) => fail(error.message, notebook)));
  return {
    generate: (
      notebookInput: unknown,
      contextInput: unknown,
      optionsInput: unknown,
      now: number,
      existingCards: unknown = [],
    ) =>
      Effect.gen(function* () {
        const notebook = yield* Schema.decodeUnknown(KnowledgeNotebookSchema)(notebookInput).pipe(
          Effect.mapError(() => fail("The saved study notebook could not be validated.", null)),
        );
        const options = yield* Schema.decodeUnknown(GenerateInput)(optionsInput).pipe(
          Effect.mapError(() =>
            fail("Select a source section, concept and study depth.", notebook),
          ),
        );
        const context = yield* Schema.decodeUnknown(TutorContextSchema)(contextInput).pipe(
          Effect.mapError(() => fail("The learning area could not be validated.", notebook)),
        );
        const section = notebook.materials
          ?.find((material) => material.id === options.materialId)
          ?.sections.find((item) => item.id === options.sectionId);
        const concept = notebook.concepts.find((item) => item.id === options.conceptId);
        if (context.knowledgeArea.id !== notebook.areaId || !concept || !section?.selected)
          return yield* Effect.fail(
            fail("Select an available concept and source section in this learning area.", notebook),
          );
        if (section.text.length > 12000)
          return yield* Effect.fail(
            fail(
              "Split this section into excerpts of at most 12,000 characters before generation. No content was sent.",
              notebook,
            ),
          );
        const claim =
          options.claimId === undefined
            ? undefined
            : notebook.coveragePlans
                ?.find(
                  (plan) =>
                    plan.materialId === options.materialId && plan.sectionId === options.sectionId,
                )
                ?.claims.find((item) => item.id === options.claimId);
        if (options.claimId !== undefined && (!claim || claim.decision !== "selected"))
          return yield* Effect.fail(
            fail("Approve and select this coverage claim before generating a card.", notebook),
          );
        const charged = yield* reserveNotebookRequest(notebook, now, "propose-card").pipe(
          Effect.mapError((error) => fail(error.message, notebook)),
        );
        yield* persist(charged);
        const raw = yield* api
          .request({
            action: "study-card",
            context,
            material: {
              goal: options.goal ?? notebook.goal,
              depth: options.depth,
              ...(claim ? { claim: { title: claim.title, description: claim.description } } : {}),
              objectiveId: concept.objectiveId ?? null,
              sources: [
                {
                  materialId: options.materialId,
                  sectionId: options.sectionId,
                  text: section.text,
                  pageNumber: section.pageNumber,
                },
              ],
              previousFronts: notebook.proposals
                .filter((proposal) => proposal.status !== "discarded")
                .slice(-30)
                .map((proposal) => proposal.proposal.front),
            },
          })
          .pipe(
            Effect.mapError((providerFailure) => ({
              ...fail(tutorApiFailureMessage(providerFailure), charged),
              providerFailure,
            })),
          );
        const response = yield* Schema.decodeUnknown(TutorActionResponseSchema)(raw).pipe(
          Effect.mapError(() => fail("The source card response could not be validated.", charged)),
        );
        if (response.action !== "study-card")
          return yield* Effect.fail(
            fail("The source card response did not match this request.", charged),
          );
        if (
          response.result.sourceReferences.some(
            (reference) =>
              reference.materialId !== options.materialId ||
              reference.sectionId !== options.sectionId ||
              reference.pageNumber !== section.pageNumber ||
              !section.text.includes(reference.quote),
          )
        )
          return yield* Effect.fail(
            fail("The provider cited content outside the excerpt sent for this request.", charged),
          );
        const next = yield* addMaterialCardProposals(
          charged,
          {
            materialId: options.materialId,
            sectionId: options.sectionId,
            proposals: [
              {
                id: response.proposalId,
                ...(claim ? { claimId: claim.id } : {}),
                conceptId: concept.id,
                proposal: response.result.proposal,
                sourceReferences: response.result.sourceReferences,
                createdAt: now,
                providerSessionId: response.sessionId,
                providerResolutionRequired: response.providerResolutionRequired ?? true,
              },
            ],
          },
          existingCards,
        ).pipe(Effect.mapError((error) => fail(error.message, charged)));
        yield* persist(next);
        return { notebook: next, conceptSuggestions: response.result.conceptSuggestions };
      }),
  };
}
