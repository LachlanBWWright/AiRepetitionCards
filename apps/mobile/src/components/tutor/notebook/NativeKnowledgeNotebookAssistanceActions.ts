import { Effect, Either } from "effect";
import { createCardAssistanceTutor, applyNotebookRefinement } from "@recall/application";
import type {
  CardRefinementInput,
  CardRefinementResult,
  CardInspectionResult,
  StudySourcePassage,
} from "@recall/ai-core";
import type { NativeNotebookState } from "./useNativeKnowledgeNotebookState";
import type { createNativeKnowledgeNotebookPracticeActions } from "./practice/NativeKnowledgeNotebookPracticeActions";
export function createNativeKnowledgeNotebookAssistanceActions(
  context: NativeNotebookState &
    Pick<ReturnType<typeof createNativeKnowledgeNotebookPracticeActions>, "persistBeforeRequest">,
) {
  const {
    pendingProposal,
    notebook,
    proposalContent,
    api,
    runAction,
    persistBeforeRequest,
    area,
    save,
    setNotice,
    createId,
    setProposalDraft,
  } = context;
  function assistanceSources(): readonly StudySourcePassage[] {
    const reference = pendingProposal?.sourceReferences?.[0];
    if (!reference) return [];
    const source = notebook?.materials
      ?.find((item) => item.id === reference.materialId)
      ?.sections.find((item) => item.id === reference.sectionId);
    return source
      ? [
          {
            materialId: reference.materialId,
            sectionId: reference.sectionId,
            text: source.text,
            pageNumber: source.pageNumber,
          },
        ]
      : [];
  }
  async function refineProposal(mode: CardRefinementInput["mode"], instructions: string) {
    let response: CardRefinementResult | null = null;
    if (!notebook || !proposalContent || !api) return response;
    await runAction(async (isCurrent) => {
      const result = await Effect.runPromise(
        Effect.either(
          createCardAssistanceTutor(api, persistBeforeRequest).refine(
            notebook,
            { knowledgeArea: area, history: [] },
            { ...proposalContent, mode, instructions, sources: assistanceSources() },
            Date.now(),
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) {
        if (result.left.notebook) await save(result.left.notebook);
        setNotice(result.left.message);
      } else if (result.right.notebook && (await save(result.right.notebook)))
        response = result.right.result;
    });
    return response;
  }
  async function inspectProposal() {
    let response: CardInspectionResult | null = null;
    if (!notebook || !proposalContent || !api) return response;
    await runAction(async (isCurrent) => {
      const result = await Effect.runPromise(
        Effect.either(
          createCardAssistanceTutor(api, persistBeforeRequest).inspect(
            notebook,
            { knowledgeArea: area, history: [] },
            { ...proposalContent, sources: assistanceSources() },
            Date.now(),
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) {
        if (result.left.notebook) await save(result.left.notebook);
        setNotice(result.left.message);
      } else if (result.right.notebook && (await save(result.right.notebook)))
        response = result.right.result;
    });
    return response;
  }
  async function applyRefinement(result: CardRefinementResult) {
    let applied = false;
    if (!notebook || !pendingProposal || !proposalContent) return false;
    await runAction(async (isCurrent) => {
      const next = Effect.runSync(
        Effect.either(
          applyNotebookRefinement(
            notebook,
            {
              proposalId: pendingProposal.id,
              baseline: {
                front: pendingProposal.proposal.front,
                back: pendingProposal.proposal.back,
                objectiveId: pendingProposal.proposal.objectiveId,
              },
              cards: result.cards,
              newProposalIds: result.cards.length > 1 ? result.cards.map(() => createId()) : [],
            },
            area.cards,
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(next)) setNotice(next.left.message);
      else if (await save(next.right)) {
        setProposalDraft(null);
        applied = true;
        setNotice(
          "Refined proposals saved. Review and approve each before adding it to your deck.",
        );
      }
    });
    return applied;
  }
  return { refineProposal, inspectProposal, applyRefinement } as const;
}
