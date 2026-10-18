import type { KnowledgeArea, ReviewEvent } from "@recall/domain";
import { type CardDuplicateCandidate, type WorkspaceSearchTarget } from "@recall/application";
import type { CardProposal } from "@recall/ai-core";
import type { makeNativeTutorApi } from "../../../storage/ai/native-tutor-api";
export const NotebookSection = {
  Practice: "Tutor practice",
  StudyMaterials: "Study materials",
  ReviewSuggestions: "Review suggestions",
} as const;
export type NotebookSection = (typeof NotebookSection)[keyof typeof NotebookSection];
export const notebookSections = [
  NotebookSection.Practice,
  NotebookSection.StudyMaterials,
  NotebookSection.ReviewSuggestions,
] as const satisfies readonly NotebookSection[];
export type TutorApi = ReturnType<typeof makeNativeTutorApi>;
export const failureMessage =
  "The notebook could not be updated. Your saved cards and review history are unchanged.";

export type NativeKnowledgeNotebookProps = {
  readonly experience?: "chat";
  readonly sessionOnly?: boolean;
  readonly onStartReview?: (() => void) | undefined;
  readonly activityOverride?: "materials" | undefined;
  readonly initialActivity?: "materials" | undefined;
  readonly area: KnowledgeArea;
  readonly searchTarget?: WorkspaceSearchTarget | undefined;
  readonly duplicateCandidates?: readonly CardDuplicateCandidate[];
  readonly storageNamespace?: string;
  readonly reviewEvents: readonly ReviewEvent[];
  readonly api: TutorApi | null;
  readonly createId: () => string;
  readonly mayWrite: () => boolean;
  readonly onApproveProposal: (
    proposal: CardProposal,
    proposalId: string,
    sessionId: string,
  ) => Promise<{ readonly cardId: string; readonly content: CardProposal } | null>;
};
