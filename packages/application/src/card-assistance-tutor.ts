import { Effect, Schema } from "effect";
import {
  CardRefinementInputSchema,
  CardInspectionInputSchema,
  decodeTutorContext,
  TutorActionResponseSchema,
} from "@recall/ai-core";
import {
  KnowledgeNotebookSchema,
  reserveNotebookRequest,
  type KnowledgeNotebook,
} from "./knowledge-notebook";
import { addStudyCoveragePlan } from "./study-coverage";
import { createTutorApi, tutorApiFailureMessage } from "./tutor-api";
import type { NotebookTutorFailure } from "./knowledge-notebook-tutor";
const fail = (message: string, notebook: KnowledgeNotebook | null): NotebookTutorFailure => ({
  _tag: "NotebookTutorFailure",
  message,
  notebook,
});
/** Application reservations are durably written before inference; transport adapters also enforce device/account budgets. */
export function createCardAssistanceTutor(
  api: Pick<ReturnType<typeof createTutorApi>, "request">,
  persistBeforeRequest?: (
    notebook: KnowledgeNotebook,
  ) => Effect.Effect<void, { readonly message: string }>,
) {
  const prepare = (notebookInput: unknown, contextInput: unknown, now: number) =>
    Effect.gen(function* () {
      const notebook =
        notebookInput === null
          ? null
          : yield* Schema.decodeUnknown(KnowledgeNotebookSchema)(notebookInput).pipe(
              Effect.mapError(() => fail("The saved notebook could not be validated.", null)),
            );
      const context = yield* decodeTutorContext(contextInput).pipe(
        Effect.mapError(() => fail("The learning context could not be validated.", notebook)),
      );
      if (notebook && notebook.areaId !== context.knowledgeArea.id)
        return yield* Effect.fail(fail("The notebook belongs to another learning area.", notebook));
      if (!notebook) return { notebook, context };
      if (!persistBeforeRequest)
        return yield* Effect.fail(
          fail("A durable notebook adapter is required before sending an AI request.", notebook),
        );
      const charged = yield* reserveNotebookRequest(notebook, now, "propose-card").pipe(
        Effect.mapError((error) => fail(error.message, notebook)),
      );
      yield* persistBeforeRequest(charged).pipe(
        Effect.mapError((error) => fail(error.message, charged)),
      );
      return { notebook: charged, context };
    });
  const request = (input: Parameters<typeof api.request>[0], notebook: KnowledgeNotebook | null) =>
    api.request(input).pipe(
      Effect.mapError((error) => ({
        ...fail(tutorApiFailureMessage(error), notebook),
        providerFailure: error,
      })),
      Effect.flatMap((raw) =>
        Schema.decodeUnknown(TutorActionResponseSchema)(raw).pipe(
          Effect.mapError(() => fail("The AI response could not be validated.", notebook)),
        ),
      ),
    );
  return {
    refine: (notebookInput: unknown, contextInput: unknown, input: unknown, now: number) =>
      Effect.gen(function* () {
        const refinement = yield* Schema.decodeUnknown(CardRefinementInputSchema)(input).pipe(
          Effect.mapError(() => fail("The refinement input could not be validated.", null)),
        );
        const prepared = yield* prepare(notebookInput, contextInput, now);
        const response = yield* request(
          { action: "refine-card", context: prepared.context, refinement },
          prepared.notebook,
        );
        if (response.action !== "refine-card")
          return yield* Effect.fail(
            fail("The response does not match the refinement request.", prepared.notebook),
          );
        if (
          response.result.cards.some(
            (card) =>
              card.objectiveId !== refinement.objectiveId ||
              card.sourceReferences.some(
                (reference) =>
                  !refinement.sources.some(
                    (source) =>
                      source.materialId === reference.materialId &&
                      source.sectionId === reference.sectionId &&
                      source.pageNumber === reference.pageNumber &&
                      source.text.includes(reference.quote),
                  ),
              ) ||
              (refinement.sources.length > 0 && card.sourceReferences.length === 0),
          )
        )
          return yield* Effect.fail(
            fail(
              "The revision changed the objective or cited an unavailable passage.",
              prepared.notebook,
            ),
          );
        if (
          refinement.mode === "cloze" &&
          response.result.cards.some((card) => !/\{\{c[1-9]\d*::[^{}]+\}\}/u.test(card.front))
        )
          return yield* Effect.fail(
            fail(
              "The provider did not return a valid cloze deletion. Request a new revision.",
              prepared.notebook,
            ),
          );
        return {
          notebook: prepared.notebook,
          result: response.result,
          baseline: {
            front: refinement.front,
            back: refinement.back,
            objectiveId: refinement.objectiveId,
          },
        };
      }),
    inspect: (notebookInput: unknown, contextInput: unknown, input: unknown, now: number) =>
      Effect.gen(function* () {
        const inspection = yield* Schema.decodeUnknown(CardInspectionInputSchema)(input).pipe(
          Effect.mapError(() => fail("The quality inspection input could not be validated.", null)),
        );
        const prepared = yield* prepare(notebookInput, contextInput, now);
        const response = yield* request(
          { action: "inspect-card", context: prepared.context, inspection },
          prepared.notebook,
        );
        if (response.action !== "inspect-card")
          return yield* Effect.fail(
            fail("The response does not match the inspection request.", prepared.notebook),
          );
        return { notebook: prepared.notebook, result: response.result };
      }),
    plan: (notebookInput: unknown, contextInput: unknown, input: unknown, now: number) =>
      Effect.gen(function* () {
        const options = yield* Schema.decodeUnknown(
          Schema.Struct({
            materialId: Schema.UUID,
            sectionId: Schema.UUID,
            depth: Schema.Literal("overview", "standard", "detailed"),
            goal: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000))),
            planId: Schema.UUID,
            claimIds: Schema.Array(Schema.UUID).pipe(Schema.minItems(20), Schema.maxItems(20)),
          }),
        )(input).pipe(
          Effect.mapError(() =>
            fail("Select a source and provide identities for the coverage plan.", null),
          ),
        );
        const validated = yield* Schema.decodeUnknown(KnowledgeNotebookSchema)(notebookInput).pipe(
          Effect.mapError(() => fail("The study notebook is invalid.", null)),
        );
        if ((validated.coveragePlans?.length ?? 0) >= 200)
          return yield* Effect.fail(
            fail(
              "This notebook already contains the maximum 200 coverage plans. No AI request was sent.",
              validated,
            ),
          );
        const section = validated.materials
          ?.find((item) => item.id === options.materialId)
          ?.sections.find((item) => item.id === options.sectionId);
        if (
          !section?.selected ||
          section.text.length > 12000 ||
          new Set(options.claimIds).size !== options.claimIds.length ||
          validated.coveragePlans?.some(
            (plan) =>
              plan.id === options.planId ||
              plan.claims.some((claim) => options.claimIds.includes(claim.id)),
          )
        )
          return yield* Effect.fail(
            fail(
              "Select a saved excerpt of at most 12,000 characters and fresh plan identities.",
              validated,
            ),
          );
        const prepared = yield* prepare(validated, contextInput, now);
        if (!prepared.notebook)
          return yield* Effect.fail(fail("A study notebook is required.", null));
        const response = yield* request(
          {
            action: "plan-study",
            context: prepared.context,
            material: {
              goal: options.goal ?? validated.goal,
              depth: options.depth,
              sources: [
                {
                  materialId: options.materialId,
                  sectionId: options.sectionId,
                  text: section.text,
                  pageNumber: section.pageNumber,
                },
              ],
            },
          },
          prepared.notebook,
        );
        if (response.action !== "plan-study")
          return yield* Effect.fail(
            fail("The response does not match the coverage request.", prepared.notebook),
          );
        const next = yield* addStudyCoveragePlan(prepared.notebook, {
          id: options.planId,
          materialId: options.materialId,
          sectionId: options.sectionId,
          createdAt: now,
          claims: response.result.claims.map((claim, index) => ({
            ...claim,
            id: options.claimIds[index],
            decision: "pending",
          })),
        }).pipe(Effect.mapError((error) => fail(error.message, prepared.notebook)));
        if (persistBeforeRequest)
          yield* persistBeforeRequest(next).pipe(
            Effect.mapError((error) => fail(error.message, next)),
          );
        return next;
      }),
  };
}
