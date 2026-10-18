import type { KnowledgeNotebook } from "@recall/application";
import { NativeButton } from "../../../ui/NativeButton";
import { Text, View } from "react-native";
import { NotebookSection } from "../NativeKnowledgeNotebookTypes";
import type { NativeNotebookModel } from "../useNativeKnowledgeNotebookModel";
export function NativeKnowledgeNotebookHistory({ model }: { readonly model: NativeNotebookModel }) {
  const { section, latestEvidence, showEvidence, setShowEvidence, notebook } = model;
  if (!notebook) return null;
  return (
    <View className={section === NotebookSection.Practice ? "gap-[11px]" : "hidden"}>
      {latestEvidence?.kind === "tutor" ? (
        <View className={"gap-[7px] py-[12px] border-t border-t-recall-line"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>
            Tutor feedback · {latestEvidence.evaluation.result}
          </Text>
          <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
            {latestEvidence.evaluation.feedback}
          </Text>
          {latestEvidence.evaluation.misconception ? (
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
              Possible misconception: {latestEvidence.evaluation.misconception}
            </Text>
          ) : null}
        </View>
      ) : null}
      <NativeButton
        label={showEvidence ? "Hide history" : "Answer history"}
        onPress={() => {
          setShowEvidence((current) => !current);
        }}
        className={"py-[9px] px-[4px]"}
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      {showEvidence && notebook.evidence.length > 0 ? (
        <View className={"gap-[7px] py-[12px] border-t border-t-recall-line"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>Recent recorded evidence</Text>
          {notebook.evidence
            .slice(-10)
            .reverse()
            .map((entry) => (
              <NativeKnowledgeNotebookEvidence key={entry.id} notebook={notebook} entry={entry} />
            ))}
        </View>
      ) : null}
    </View>
  );
}

function NativeKnowledgeNotebookEvidence({
  notebook,
  entry,
}: {
  readonly notebook: KnowledgeNotebook;
  readonly entry: KnowledgeNotebook["evidence"][number];
}) {
  return (
    <View key={entry.id} className={"gap-[3px] py-[7px] border-b-recall-line border-b"}>
      <Text className={"text-recall-ink font-bold text-[13px]"}>
        {notebook.concepts.find((item) => item.id === entry.conceptId)?.title}
      </Text>
      {entry.kind === "tutor" ? (
        <>
          <Text className={"text-recall-ink text-[13px] leading-[19px]"}>{entry.question}</Text>
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
            Your answer: {entry.answer} · {entry.learnerConfidence}
          </Text>
          <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
            {entry.evaluation.feedback}
          </Text>
        </>
      ) : (
        <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
          Review rating: {entry.reviewEvent.rating}
        </Text>
      )}
    </View>
  );
}
