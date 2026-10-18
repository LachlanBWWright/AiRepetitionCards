import { Effect, Either, Schema } from "effect";
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  CardInspectionResult,
  CardProposal,
  CardRefinementInput,
  CardRefinementResult,
  TutorSessionState,
} from "@recall/ai-core";
import { CardProposalSchema, selectTutorContextHistory } from "@recall/ai-core";
import {
  applyNotebookRefinement,
  createCardAssistanceTutor,
  importTutorProposal,
  tutorApiFailureMessage,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import {
  readNativeKnowledgeNotebook,
  writeNativeKnowledgeNotebook,
} from "../../../storage/ai/native-knowledge-notebook-store";
import type { makeNativeTutorApi } from "../../../storage/ai/native-tutor-api";

type TutorApi = ReturnType<typeof makeNativeTutorApi>;
type ProposalSetter = Dispatch<
  SetStateAction<{
    readonly key: string;
    readonly content: CardProposal;
  } | null>
>;
type SessionSetter = Dispatch<SetStateAction<TutorSessionState | null>>;

export interface NativeTutorProposalWorkflowDependencies {
  readonly area: KnowledgeArea | null;
  readonly api: TutorApi | null;
  readonly mayWrite: () => boolean;
  readonly proposalContent: CardProposal | null;
  readonly proposalKey: string | null;
  readonly approvalSaved: boolean;
  readonly duplicatesAllowed: boolean;
  readonly session: TutorSessionState | null;
  readonly sessionId: string | null;
  readonly refinementNamespace: string;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  readonly setNotice: Dispatch<SetStateAction<string | null>>;
  readonly setDraft: ProposalSetter;
  readonly setSession: SessionSetter;
  readonly setNotebookReload: Dispatch<SetStateAction<number>>;
  readonly setShowRefinementNotebook: Dispatch<SetStateAction<boolean>>;
  readonly savedApproval: {
    readonly key: string;
    readonly cardId: string;
    readonly content: CardProposal;
  } | null;
  readonly setSavedApproval: Dispatch<
    SetStateAction<{
      readonly key: string;
      readonly cardId: string;
      readonly content: CardProposal;
    } | null>
  >;
  readonly onApproveProposal: (
    proposal: CardProposal,
    proposalId: string,
    sessionId: string,
  ) => Promise<{ readonly cardId: string; readonly content: CardProposal } | null>;
  readonly createId: () => string;
}

export function useNativeTutorProposalWorkflows(
  dependencies: NativeTutorProposalWorkflowDependencies,
) {
  const assistanceLocked = useRef(false);
  const approvalEpoch = useRef(0);
  useEffect(() => {
    approvalEpoch.current += 1;
    return () => {
      approvalEpoch.current += 1;
    };
  }, [dependencies.proposalKey, dependencies.api]);
  const {
    area,
    api,
    mayWrite,
    proposalContent,
    proposalKey,
    approvalSaved,
    duplicatesAllowed,
    session,
    sessionId,
    refinementNamespace,
    setBusy,
    setNotice,
    setDraft,
    setSession,
    setNotebookReload,
    setShowRefinementNotebook,
    savedApproval,
    setSavedApproval,
    onApproveProposal,
    createId,
  } = dependencies;
  async function assistProposal(mode: CardRefinementInput["mode"], instructions: string) {
    if (
      !area ||
      !api ||
      !proposalContent ||
      !mayWrite() ||
      approvalSaved ||
      assistanceLocked.current
    )
      return null;
    assistanceLocked.current = true;
    const epoch = approvalEpoch.current;
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        createCardAssistanceTutor(api).refine(
          null,
          { knowledgeArea: area, history: selectTutorContextHistory(session?.history ?? []) },
          { ...proposalContent, mode, instructions, sources: [] },
          Date.now(),
        ),
      ),
    );
    assistanceLocked.current = false;
    if (approvalEpoch.current !== epoch || !mayWrite()) return null;
    setBusy(false);
    if (Either.isLeft(result)) {
      setNotice(result.left.message);
      return null;
    }
    return result.right.result;
  }

  async function inspectProposal(): Promise<CardInspectionResult | null> {
    if (
      !area ||
      !api ||
      !proposalContent ||
      !mayWrite() ||
      approvalSaved ||
      assistanceLocked.current
    )
      return null;
    assistanceLocked.current = true;
    const epoch = approvalEpoch.current;
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        createCardAssistanceTutor(api).inspect(
          null,
          { knowledgeArea: area, history: selectTutorContextHistory(session?.history ?? []) },
          { ...proposalContent, sources: [] },
          Date.now(),
        ),
      ),
    );
    assistanceLocked.current = false;
    if (approvalEpoch.current !== epoch || !mayWrite()) return null;
    setBusy(false);
    if (Either.isLeft(result)) {
      setNotice(result.left.message);
      return null;
    }
    return result.right.result;
  }

  async function keepRefinement(result: CardRefinementResult): Promise<boolean> {
    if (
      !area ||
      !session?.proposal ||
      !proposalContent ||
      !proposalKey ||
      !sessionId ||
      !mayWrite() ||
      approvalSaved ||
      assistanceLocked.current
    )
      return false;
    if (result.cards.length === 1 && result.cards[0]) {
      setDraft({ key: proposalKey, content: result.cards[0] });
      return true;
    }
    assistanceLocked.current = true;
    const epoch = approvalEpoch.current;
    const sourceProposal = session.proposal;
    const sourceArea = area;
    const matchingQuizAnswers =
      session.quiz?.questions.filter(
        (item) =>
          item.evaluation &&
          session.evaluation &&
          JSON.stringify(item.evaluation) === JSON.stringify(session.evaluation),
      ) ?? [];
    const quizEvidence = matchingQuizAnswers.length === 1 ? matchingQuizAnswers[0] : undefined;
    const learnerIndex = session.history.reduce(
      (last, item, index) => (item.role === "learner" ? index : last),
      -1,
    );
    const observedAnswer = quizEvidence?.learnerAnswer ?? session.history[learnerIndex]?.content;
    const observedQuestion =
      quizEvidence?.prompt ??
      session.history
        .slice(0, learnerIndex)
        .reverse()
        .find((item) => item.role === "assistant")?.content;
    if (
      !observedAnswer ||
      !observedQuestion ||
      !session.evaluation ||
      matchingQuizAnswers.length > 1
    ) {
      assistanceLocked.current = false;
      setNotice(
        "The original question, answer and evaluation are required to retain evidence for split proposals. Evaluate a fresh answer first.",
      );
      return false;
    }
    setBusy(true);
    const transferred = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const stored = yield* readNativeKnowledgeNotebook(
            sourceArea.id,
            refinementNamespace,
          ).pipe(
            Effect.mapError(() => ({
              message: "Your notebook could not be read. Its saved data was preserved.",
            })),
          );
          const notebook = stored;
          const imported = yield* importTutorProposal(
            notebook,
            sourceArea,
            {
              proposalId: sourceProposal.proposalId,
              sessionId,
              proposal: proposalContent,
              evaluation: session.evaluation,
              question: observedQuestion,
              answer: observedAnswer,
              evidenceId: createId(),
              now: Date.now(),
            },
            sourceArea.cards,
          );
          const next = yield* applyNotebookRefinement(
            imported,
            {
              proposalId: sourceProposal.proposalId,
              baseline: {
                front: proposalContent.front,
                back: proposalContent.back,
                objectiveId: proposalContent.objectiveId,
              },
              cards: result.cards,
              newProposalIds: result.cards.map(() => createId()),
            },
            sourceArea.cards,
          );
          yield* writeNativeKnowledgeNotebook(
            sourceArea.id,
            next,
            () => approvalEpoch.current === epoch && mayWrite(),
            refinementNamespace,
          ).pipe(
            Effect.mapError(() => ({
              message:
                "The split proposals could not be saved. The original proposal remains available.",
            })),
          );
        }),
      ),
    );
    assistanceLocked.current = false;
    if (approvalEpoch.current !== epoch || !mayWrite()) return false;
    setBusy(false);
    if (Either.isLeft(transferred)) {
      setNotice(transferred.left.message);
      return false;
    }
    setNotebookReload((previous) => previous + 1);
    setShowRefinementNotebook(true);
    setSession((current) => (current ? { ...current, proposal: null } : current));
    setNotice("Split suggestions saved. Open Split suggestions to review them.");
    return true;
  }

  async function resolveProposal(state: "approved" | "rejected") {
    const proposal = session?.proposal;
    if (!api || !proposal || !sessionId) return;
    if (state === "approved" && !duplicatesAllowed) {
      setNotice("Review the possible duplicates and choose Keep both before saving.");
      return;
    }
    const key = proposalKey;
    const epoch = approvalEpoch.current;
    if (!key) return;
    const currentApproval = () => approvalEpoch.current === epoch;
    const edited = Schema.decodeUnknownEither(CardProposalSchema)({
      ...proposalContent,
      front: proposalContent?.front.trim(),
      back: proposalContent?.back.trim(),
      rationale: proposalContent?.rationale.trim(),
    });
    if (
      state === "approved" &&
      (Either.isLeft(edited) ||
        (edited.right.objectiveId !== null &&
          !area?.objectives.some((objective) => objective.id === edited.right.objectiveId)))
    ) {
      setNotice(
        "Enter a question, answer and rationale within the field limits, and choose an objective from this area.",
      );
      return;
    }
    setBusy(true);
    setNotice(null);
    let cardId: string | undefined;
    let content = proposal.content;
    if (state === "approved" && Either.isRight(edited)) {
      const saved =
        savedApproval?.key === key
          ? savedApproval
          : await onApproveProposal(edited.right, proposal.proposalId, sessionId);
      if (!currentApproval()) return;
      if (!saved) {
        setBusy(false);
        setNotice(
          "The card could not be saved locally, so approval was not sent. Your edits remain available to retry.",
        );
        return;
      }
      cardId = saved.cardId;
      content = saved.content;
      setSavedApproval({ key, cardId, content });
      setDraft({ key, content });
      if (
        content.front !== edited.right.front ||
        content.back !== edited.right.back ||
        content.objectiveId !== edited.right.objectiveId ||
        content.rationale !== edited.right.rationale
      ) {
        setBusy(false);
        setNotice(
          "This proposal already has a saved card. Its durable content has been restored without overwriting it. Retry approval to acknowledge that saved card.",
        );
        return;
      }
    }
    const result = await Effect.runPromise(
      Effect.either(
        api.resolveProposal({
          proposalId: proposal.proposalId,
          state,
          ...(state === "approved" && cardId ? { cardId, content } : {}),
        }),
      ),
    );
    if (!currentApproval()) return;
    setBusy(false);
    if (Either.isLeft(result)) {
      setNotice(
        state === "approved"
          ? `The card is saved locally. ${tutorApiFailureMessage(result.left)} Retry approval to acknowledge the saved card.`
          : tutorApiFailureMessage(result.left),
      );
      return;
    }
    setSession((current) => (current ? { ...current, proposal: null } : current));
    setNotice(state === "approved" ? "Saved." : "Discarded.");
  }

  return { assistProposal, inspectProposal, keepRefinement, resolveProposal };
}
