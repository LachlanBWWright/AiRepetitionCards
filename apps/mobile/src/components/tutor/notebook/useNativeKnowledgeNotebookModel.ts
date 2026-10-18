import type { NativeKnowledgeNotebookProps } from "./NativeKnowledgeNotebookTypes";
import { useNativeKnowledgeNotebookState } from "./useNativeKnowledgeNotebookState";
import { createNativeKnowledgeNotebookPracticeActions } from "./practice/NativeKnowledgeNotebookPracticeActions";
import { createNativeKnowledgeNotebookAssistanceActions } from "./NativeKnowledgeNotebookAssistanceActions";
import { createNativeKnowledgeNotebookProposalActions } from "./proposals/NativeKnowledgeNotebookProposalActions";
import { createNativeKnowledgeNotebookClearAction } from "./NativeKnowledgeNotebookClearAction";
export function useNativeKnowledgeNotebookModel(props: NativeKnowledgeNotebookProps) {
  const state = useNativeKnowledgeNotebookState(props);
  const practice = createNativeKnowledgeNotebookPracticeActions(state);
  const context = { ...state, ...practice };
  return {
    ...context,
    ...createNativeKnowledgeNotebookAssistanceActions(context),
    ...createNativeKnowledgeNotebookProposalActions(context),
    ...createNativeKnowledgeNotebookClearAction(context),
  } as const;
}
export type NativeNotebookModel = ReturnType<typeof useNativeKnowledgeNotebookModel>;
