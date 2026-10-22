import type { ChatModelSelection } from "../chat/chat-model-selection";
import type { ReactNode } from "react";
import type {
  CardDuplicateCandidate,
  KnowledgeNotebook,
  WorkspaceSearchTarget,
} from "@recall/application";
import type { CardProposal, KnowledgeGap } from "@recall/ai-core";
import type { KnowledgeArea, ReviewEvent } from "@recall/domain";
import type { tutorApi } from "@/lib/tutor-api";

export type KnowledgeNotebookPanelProps = {
  readonly experience?: "chat";
  readonly modelSelection?: ChatModelSelection | undefined;
  readonly sessionOnly?: boolean;
  readonly aiUnavailableReason?: string | null;
  readonly knowledgeArea: KnowledgeArea;
  readonly duplicateCandidates?: readonly CardDuplicateCandidate[];
  readonly api?: typeof tutorApi;
  readonly sessionNamespace?: string;
  readonly reviewEvents?: readonly ReviewEvent[];
  readonly initialNotebook?: KnowledgeNotebook;
  readonly searchTarget?: WorkspaceSearchTarget;
  readonly initialGoal?: string;
  readonly activityOverride?: "materials" | undefined;
  readonly initialActivity?: "practice" | "quick" | "materials" | "suggestions";
  readonly quickQuestions?: ReactNode;
  readonly research?: ReactNode;
  readonly additionalSuggestions?: ReactNode;
  readonly practiceTopics?: readonly KnowledgeGap[];
  readonly onPracticeTopic?: (topic: KnowledgeGap) => void;
  readonly quickQuestionsBusy?: boolean;
  readonly showActivityNavigation?: boolean;
  readonly demo?: boolean;
  readonly onApprove: (
    proposal: CardProposal,
    cardId: string,
    proposalId: string,
    sessionId: string,
  ) => Promise<CardProposal | null>;
  readonly onStartReview?: () => void;
  readonly clock?: () => number;
};

export type NotebookNoticeFailure = {
  readonly message: string;
  readonly notebook?: KnowledgeNotebook | null;
};
