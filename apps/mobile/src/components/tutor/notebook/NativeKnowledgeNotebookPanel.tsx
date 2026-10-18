import { NativeImprovementChat } from "../chat/NativeImprovementChat";
import { NativeButton } from "../../ui/NativeButton";
import { ScrollView, Text, TextInput, View } from "react-native";
import { NativeStudyMaterialsPanel } from "../materials/NativeStudyMaterialsPanel";
import { notebookSections, NotebookSection } from "./NativeKnowledgeNotebookTypes";
import type { NativeKnowledgeNotebookProps } from "./NativeKnowledgeNotebookTypes";
import { useNativeKnowledgeNotebookModel } from "./useNativeKnowledgeNotebookModel";
import { NativeKnowledgeNotebookPractice } from "./practice/NativeKnowledgeNotebookPractice";
import { NativeKnowledgeNotebookQueue } from "./proposals/NativeKnowledgeNotebookQueue";
import { NativeKnowledgeNotebookHistory } from "./practice/NativeKnowledgeNotebookHistory";
import { NativeKnowledgeNotebookProposal } from "./proposals/NativeKnowledgeNotebookProposal";
import { NativeKnowledgeNotebookSettings } from "./NativeKnowledgeNotebookSettings";
export function NativeKnowledgeNotebookPanel(props: NativeKnowledgeNotebookProps) {
  const state = useNativeKnowledgeNotebookModel(props);
  const model = props.activityOverride
    ? { ...state, section: NotebookSection.StudyMaterials }
    : state;
  if (props.experience === "chat" && !props.activityOverride)
    return <NativeImprovementChat model={model} />;
  const {
    searchedConcept,
    searchedEvidence,
    searchedProposal,
    setSection,
    section,
    notebook,
    searchTarget,
    area,
    api,
    goal,
    createId,
    busy,
    loaded,
    loadFailed,
    unsaved,
    mayWrite,
    save,
    persistBeforeRequest,
    runAction,
    showSettings,
    setShowSettings,
    clearNotebook,
    setGoal,
    start,
    notice,
  } = model;
  const content = (
    <View testID="native-knowledge-notebook" className={"gap-[11px] mt-[12px]"}>
      {searchedConcept ? (
        <View accessibilityLiveRegion="polite" className={"gap-[11px]"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>{searchedConcept.title}</Text>
          {searchedConcept.description ? (
            <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
              {searchedConcept.description}
            </Text>
          ) : null}
        </View>
      ) : null}
      {searchedEvidence ? (
        <View accessibilityLiveRegion="polite" className={"gap-[11px]"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>Selected discussion</Text>
          {searchedEvidence.kind === "tutor" ? (
            <>
              <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                {searchedEvidence.question}
              </Text>
              <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                Your answer: {searchedEvidence.answer}
              </Text>
              <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                {searchedEvidence.evaluation.feedback}
              </Text>
            </>
          ) : (
            <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
              Review rating: {searchedEvidence.reviewEvent.rating}
            </Text>
          )}
        </View>
      ) : null}
      {searchedProposal && searchedProposal.status !== "pending" ? (
        <View accessibilityLiveRegion="polite" className={"gap-[11px]"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>
            {searchedProposal.proposal.front}
          </Text>
          <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
            {searchedProposal.proposal.back}
          </Text>
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
            {searchedProposal.status}
          </Text>
        </View>
      ) : null}
      <View className={props.activityOverride ? "hidden" : "flex-row flex-wrap gap-[7px]"}>
        {notebookSections.map((item) => (
          <NativeButton
            key={item}
            label={item}
            onPress={() => {
              setSection(item);
            }}
            className={
              section === item
                ? "py-[9px] px-[10px] bg-recall-darkGreen rounded-[5px]"
                : "py-[9px] px-[4px]"
            }
            labelClassName={
              section === item
                ? "text-recall-surface text-[12px] font-bold"
                : "text-recall-darkGreen text-[11px] font-bold"
            }
          />
        ))}
      </View>
      {notebook && (
        <View className={section === NotebookSection.StudyMaterials ? "gap-[11px]" : "hidden"}>
          <NativeStudyMaterialsPanel
            notebook={notebook}
            searchTarget={searchTarget}
            area={area}
            api={api}
            goal={goal}
            createId={createId}
            disabled={busy || !loaded || loadFailed || !!unsaved || !mayWrite()}
            save={save}
            persistBeforeRequest={persistBeforeRequest}
            runAction={runAction}
          />
        </View>
      )}
      {unsaved ? (
        <NativeButton
          disabled={busy}
          onPress={() =>
            void runAction(async () => {
              await save(unsaved);
            })
          }
          label="Retry saving notebook"
          className={
            "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
          }
          labelClassName="text-recall-surface text-[12px] font-bold"
        />
      ) : null}
      <NativeButton
        label={showSettings ? "Close notebook settings" : "Notebook settings"}
        onPress={() => {
          setShowSettings((current) => !current);
        }}
        className={"py-[9px] px-[4px]"}
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      {loadFailed ? (
        <NativeButton
          disabled={busy || !mayWrite()}
          onPress={clearNotebook}
          label="Clear unreadable notebook"
          className={
            "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
          }
          labelClassName="text-recall-darkGreen text-[11px] font-bold"
        />
      ) : null}
      {!notebook && section !== NotebookSection.ReviewSuggestions ? (
        <>
          <TextInput
            accessibilityLabel="Learning goal"
            onChangeText={setGoal}
            value={goal}
            className={
              "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
            placeholder="What do you want to understand?"
          />
          <NativeButton
            disabled={busy || !loaded || loadFailed || !mayWrite()}
            onPress={() =>
              void runAction(async (isCurrent) => {
                if (isCurrent()) await start();
              })
            }
            label={section === NotebookSection.StudyMaterials ? "Start" : "Start tutor practice"}
            className={
              "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
            }
            labelClassName="text-recall-surface text-[12px] font-bold"
          />
        </>
      ) : notebook ? (
        <>
          <NativeKnowledgeNotebookPractice model={model} />
          <NativeKnowledgeNotebookQueue model={model} />
          <NativeKnowledgeNotebookHistory model={model} />
          <NativeKnowledgeNotebookProposal model={model} />
          <NativeKnowledgeNotebookSettings model={model} />
        </>
      ) : null}
      {busy ? (
        <Text className={"text-recall-muted text-[11px] leading-[16px]"}>Saving…</Text>
      ) : null}
      {notice ? (
        <Text
          accessibilityRole="alert"
          className={"text-recall-darkGreen bg-recall-paper p-[9px] rounded-[9px] text-[12px]"}
        >
          {notice}
        </Text>
      ) : null}
    </View>
  );
  return props.experience === "chat" ? (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
      {content}
    </ScrollView>
  ) : (
    content
  );
}
