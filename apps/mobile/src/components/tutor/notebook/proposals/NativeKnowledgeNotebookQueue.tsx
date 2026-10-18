import { NativeNotebookBatchReview } from "./NativeNotebookBatchReview";
import { NativeButton } from "../../../ui/NativeButton";
import { View } from "react-native";
import { NotebookSection } from "../NativeKnowledgeNotebookTypes";
import type { NativeNotebookModel } from "../useNativeKnowledgeNotebookModel";
export function NativeKnowledgeNotebookQueue({ model }: { readonly model: NativeNotebookModel }) {
  const {
    section,
    onStartReview,
    notebook,
    busy,
    unsaved,
    api,
    mayWrite,
    proposeBatch,
    runAction,
    acknowledgeProposal,
  } = model;
  if (!notebook) return null;
  return (
    <View className={section === NotebookSection.ReviewSuggestions ? "gap-[11px]" : "hidden"}>
      <NativeNotebookBatchReview model={model} />
      {onStartReview && notebook.proposals.some((item) => item.status === "accepted") && (
        <NativeButton
          label="Review saved cards"
          disabled={busy || !!unsaved}
          onPress={onStartReview}
        />
      )}
      <NativeButton
        disabled={busy || !!unsaved || !api || !mayWrite()}
        onPress={() => void proposeBatch()}
        label="Suggest cards"
        className={
          "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
        }
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      {notebook.proposals
        .filter(
          (item) =>
            item.status !== "pending" &&
            !item.providerAcknowledged &&
            item.providerResolutionRequired !== false,
        )
        .map((item) => (
          <NativeButton
            key={item.id}
            disabled={busy || !api || !mayWrite()}
            onPress={() =>
              void runAction(async (isCurrent) => {
                await acknowledgeProposal(item, isCurrent);
              })
            }
            label="Retry confirmation"
            className={
              "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
            }
            labelClassName="text-recall-darkGreen text-[11px] font-bold"
          />
        ))}
    </View>
  );
}
