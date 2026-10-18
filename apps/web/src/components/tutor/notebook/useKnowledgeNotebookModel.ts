import type { KnowledgeNotebookPanelProps } from "./KnowledgeNotebookPanel.types";
import { useKnowledgeNotebookState } from "./useKnowledgeNotebookState";
import { createKnowledgeNotebookPracticeActions } from "./practice/KnowledgeNotebookPracticeActions";
import { createKnowledgeNotebookProposalActions } from "./proposals/KnowledgeNotebookProposalActions";
import { createKnowledgeNotebookStorageActions } from "./KnowledgeNotebookStorageActions";
export function useKnowledgeNotebookModel(props: KnowledgeNotebookPanelProps) {
  const state = useKnowledgeNotebookState(props);
  return {
    ...state,
    ...createKnowledgeNotebookPracticeActions(state),
    ...createKnowledgeNotebookProposalActions(state),
    ...createKnowledgeNotebookStorageActions(state),
  } as const;
}
export type KnowledgeNotebookModel = ReturnType<typeof useKnowledgeNotebookModel>;
