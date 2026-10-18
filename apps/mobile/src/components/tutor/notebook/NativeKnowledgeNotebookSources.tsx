import { Text, View } from "react-native";
import type { KnowledgeNotebook } from "@recall/application";
import type { NativeNotebookModel } from "./useNativeKnowledgeNotebookModel";
export function NativeKnowledgeNotebookSources({ model }: { readonly model: NativeNotebookModel }) {
  const { notebook, pendingProposal } = model;
  if (!notebook) return null;
  return (
    <>
      {pendingProposal?.sourceReferences?.map((reference, index) => (
        <NativeKnowledgeNotebookSource key={index} notebook={notebook} reference={reference} />
      ))}
    </>
  );
}
function NativeKnowledgeNotebookSource({
  notebook,
  reference,
}: {
  readonly notebook: KnowledgeNotebook;
  readonly reference: NonNullable<
    KnowledgeNotebook["proposals"][number]["sourceReferences"]
  >[number];
}) {
  const source = notebook.materials?.find((item) => item.id === reference.materialId);
  const passage = source?.sections.find((item) => item.id === reference.sectionId);
  return (
    <View className={"gap-[7px] py-[12px] border-t border-t-recall-line"}>
      <Text className={"text-recall-ink font-bold text-[13px]"}>
        Source: {source?.name} · {passage?.title}
        {reference.pageNumber ? ` · page ${String(reference.pageNumber)}` : ""}
      </Text>
      <Text selectable className={"text-recall-ink text-[13px] leading-[19px]"}>
        {reference.quote}
      </Text>
      <Text selectable className={"text-recall-muted text-[11px] leading-[16px]"}>
        {passage?.text}
      </Text>
    </View>
  );
}
