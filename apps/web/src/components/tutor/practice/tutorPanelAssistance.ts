import { Effect, Either } from "effect";
import {
  applyNotebookRefinement,
  importTutorProposal,
  seedKnowledgeNotebook,
  type KnowledgeNotebook,
} from "@recall/application";
import type { CardProposal } from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import type { KnowledgeNotebookStorageFailure } from "@/lib/knowledge-notebook-store";
type DialogueEntry = import("@recall/ai-core").TutorContext["history"][number];

export async function applyTutorPanelAssistance(
  result: import("@recall/ai-core").CardRefinementResult,
  dependencies: {
    readonly proposal: CardProposal | null;
    readonly proposalId: string | null;
    readonly sessionId: string | null;
    readonly evaluation: import("@recall/ai-core").AnswerEvaluation | null;
    readonly quiz: import("@recall/ai-core").TargetedQuizSession | null;
    readonly history: readonly DialogueEntry[];
    readonly demo: boolean;
    readonly refinementNotebook: KnowledgeNotebook | null;
    readonly refinementStore: {
      read(): Effect.Effect<KnowledgeNotebook | null, KnowledgeNotebookStorageFailure>;
      write(notebook: KnowledgeNotebook): Effect.Effect<void, KnowledgeNotebookStorageFailure>;
    };
    readonly knowledgeArea: KnowledgeArea;
    readonly clock: () => number;
    readonly setProposal: (proposal: CardProposal | null) => void;
    readonly setMessage: (message: string) => void;
    readonly setRefinementNotebook: (notebook: KnowledgeNotebook) => void;
    readonly incrementRefinementRevision: () => void;
    readonly clearProposal: () => void;
  },
): Promise<boolean> {
  const {
    proposal,
    proposalId,
    sessionId,
    evaluation,
    quiz,
    history,
    demo,
    refinementNotebook,
    refinementStore,
    knowledgeArea,
    clock,
    setProposal,
    setMessage,
    setRefinementNotebook,
    incrementRefinementRevision,
    clearProposal,
  } = dependencies;
  if (result.cards.length === 1) {
    const card = result.cards[0];
    if (!card) return false;
    setProposal({
      front: card.front,
      back: card.back,
      objectiveId: card.objectiveId,
      rationale: card.rationale,
    });
    return true;
  }
  if (!proposal || !proposalId || !sessionId || !evaluation) {
    setMessage(
      "The original tutor evidence is unavailable. Keep this proposal and refine it after continuing the tutor session.",
    );
    return false;
  }
  const matchingQuizAnswers =
    quiz?.questions.filter(
      (item) =>
        item.learnerAnswer !== null &&
        JSON.stringify(item.evaluation) === JSON.stringify(evaluation),
    ) ?? [];
  const quizEvidence = matchingQuizAnswers.length === 1 ? matchingQuizAnswers[0] : undefined;
  const learnerIndex = history.reduce(
    (last, entry, index) => (entry.role === "learner" ? index : last),
    -1,
  );
  const learner = history[learnerIndex];
  const question = history
    .slice(0, learnerIndex)
    .reverse()
    .find((entry) => entry.role === "assistant");
  const questionText = quizEvidence?.prompt ?? question?.content;
  const answerText = quizEvidence?.learnerAnswer ?? learner?.content;
  if (!questionText || answerText === undefined) {
    setMessage(
      "The original question and learner answer are required to preserve the evidence for split cards.",
    );
    return false;
  }
  const transferred = await Effect.runPromise(
    Effect.either(
      Effect.gen(function* () {
        const existing = demo ? refinementNotebook : yield* refinementStore.read();
        const seeded =
          existing ??
          (yield* seedKnowledgeNotebook(
            knowledgeArea,
            "Refine cards suggested from my tutor practice.",
          ));
        const imported = yield* importTutorProposal(
          seeded,
          knowledgeArea,
          {
            proposalId,
            sessionId,
            proposal,
            evaluation,
            question: questionText,
            answer: answerText,
            evidenceId: crypto.randomUUID(),
            now: clock(),
          },
          knowledgeArea.cards,
        );
        const revised = yield* applyNotebookRefinement(
          imported,
          {
            proposalId,
            baseline: proposal,
            cards: result.cards,
            newProposalIds: result.cards.map(() => crypto.randomUUID()),
          },
          knowledgeArea.cards,
        );
        if (!demo) yield* refinementStore.write(revised);
        return revised;
      }),
    ),
  );
  if (Either.isLeft(transferred)) {
    setMessage(transferred.left.message);
    return false;
  }
  setRefinementNotebook(transferred.right);
  incrementRefinementRevision();
  clearProposal();
  setMessage("Split proposals are saved in Suggestions. Review and approve each card there.");
  return true;
}
