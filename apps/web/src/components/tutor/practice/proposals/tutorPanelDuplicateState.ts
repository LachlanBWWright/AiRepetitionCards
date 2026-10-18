import type { AnswerEvaluation, CardProposal } from "@recall/ai-core";
import {
  findCardDuplicates,
  type CardDuplicateCandidate,
  type CardDuplicateMatch,
} from "@recall/application";
import type { TutorPanelInitialState } from "../TutorPanel";

export function getTutorPanelProposalKey(
  areaId: string,
  sessionId: string | null,
  proposalId: string | null,
): string | null {
  return proposalId && sessionId ? `${areaId}:${sessionId}:${proposalId}` : null;
}

export type TutorPanelSavedApproval = {
  readonly key: string;
  readonly content: CardProposal;
};

export function getInitialTutorPanelSavedApproval(
  initialState: TutorPanelInitialState | undefined,
  proposalKey: string | null,
): TutorPanelSavedApproval | null {
  return initialState?.approvalSaved && initialState.proposal && proposalKey
    ? { key: proposalKey, content: initialState.proposal }
    : null;
}

export function getInitialTutorPanelEvidence(
  initialState: TutorPanelInitialState | undefined,
): readonly AnswerEvaluation[] {
  return [
    ...(initialState?.observations ?? []),
    ...(initialState?.evaluation ? [initialState.evaluation] : []),
    ...(initialState?.quiz?.questions.flatMap((question) =>
      question.evaluation ? [question.evaluation] : [],
    ) ?? []),
  ];
}

export function getTutorPanelDuplicateState({
  proposal,
  candidates,
  proposalKey,
  approvalSaved,
  acknowledgement,
}: {
  readonly proposal: CardProposal | null;
  readonly candidates: readonly CardDuplicateCandidate[];
  readonly proposalKey: string | null;
  readonly approvalSaved: boolean;
  readonly acknowledgement: string | null;
}): {
  readonly matches: readonly CardDuplicateMatch[];
  readonly key: string;
  readonly allowed: boolean;
} {
  const matches = proposal ? findCardDuplicates(proposal, candidates) : [];
  const key = JSON.stringify([
    proposalKey,
    proposal?.front,
    proposal?.back,
    matches.map((match) => match.candidate),
  ]);
  return {
    matches,
    key,
    allowed: approvalSaved || matches.length === 0 || acknowledgement === key,
  };
}
