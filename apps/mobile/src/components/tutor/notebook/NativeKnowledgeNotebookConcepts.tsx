import { Text, TextInput, ScrollView, View } from "react-native";
import { NativeButton } from "../../ui/NativeButton";
import type { NativeNotebookModel } from "./useNativeKnowledgeNotebookModel";
import type { KnowledgeNotebook } from "@recall/application";
export function NativeKnowledgeNotebookConcepts({
  model,
}: {
  readonly model: NativeNotebookModel;
}) {
  const {
    notebook,
    showConcepts,
    setShowConcepts,
    conceptTitle,
    setConceptTitle,
    busy,
    mayWrite,
    runAction,
    addManualConcept,
  } = model;
  if (!notebook) return null;
  return (
    <>
      {" "}
      <NativeButton
        label={showConcepts ? "Hide concepts" : "Concepts"}
        onPress={() => {
          setShowConcepts((current) => !current);
        }}
        className={"py-[9px] px-[4px]"}
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      <View className={showConcepts ? "gap-[11px]" : "hidden"}>
        <View className={"flex-row flex-wrap gap-[7px]"}>
          <TextInput
            accessibilityLabel="Add a concept"
            onChangeText={setConceptTitle}
            value={conceptTitle}
            className={`min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink flex-1`}
            placeholder="Add a concept"
          />
          <NativeButton
            disabled={busy || !mayWrite()}
            onPress={() =>
              void runAction(async (isCurrent) => {
                if (isCurrent()) await addManualConcept();
              })
            }
            label="Add"
            className={
              "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
            }
            labelClassName="text-recall-darkGreen text-[11px] font-bold"
          />
        </View>
        <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
          {notebook.session.phase === "active"
            ? "Practice in progress"
            : notebook.session.phase === "finished"
              ? "Tutor practice finished"
              : "Ready"}
        </Text>
        <ScrollView className={"max-h-[190px]"}>
          {notebook.concepts.map((concept) => (
            <NativeKnowledgeNotebookConcept
              key={concept.id}
              model={model}
              notebook={notebook}
              concept={concept}
            />
          ))}
        </ScrollView>
      </View>
    </>
  );
}
function NativeKnowledgeNotebookConcept({
  model,
  notebook,
  concept,
}: {
  readonly model: NativeNotebookModel;
  readonly notebook: KnowledgeNotebook;
  readonly concept: KnowledgeNotebook["concepts"][number];
}) {
  const { assessments, expandedConceptId, setExpandedConceptId } = model;
  const assessment = assessments.find((entry) => entry.conceptId === concept.id);
  return (
    <View key={concept.id} className={"gap-[3px] py-[7px] border-b-recall-line border-b"}>
      <NativeButton
        label={concept.title}
        onPress={() => {
          setExpandedConceptId((current) => (current === concept.id ? null : concept.id));
        }}
        className={"py-[9px] px-[4px]"}
        labelClassName="text-recall-ink text-[13px] font-bold"
      />
      {expandedConceptId === concept.id ? (
        <>
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
            {assessment?.status ?? "unassessed"} · {assessment?.evidenceCount ?? 0} evidence item(s)
          </Text>
          {concept.parentId ? (
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
              Within:{" "}
              {notebook.concepts.find((item) => item.id === concept.parentId)?.title ??
                concept.parentId}
            </Text>
          ) : null}
          {concept.prerequisiteIds.length > 0 ? (
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
              Prerequisites:{" "}
              {concept.prerequisiteIds
                .map((id) => notebook.concepts.find((item) => item.id === id)?.title ?? id)
                .join(", ")}
            </Text>
          ) : null}
          {assessment?.reason ? (
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
              {assessment.reason}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
