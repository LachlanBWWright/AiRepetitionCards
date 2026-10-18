const practiceActionClassName =
  "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent";
import { NativeKnowledgeNotebookConcepts } from "../NativeKnowledgeNotebookConcepts";
import { NativeButton } from "../../../ui/NativeButton";
import { Text, TextInput, View } from "react-native";
import { Either } from "effect";
import { NotebookSection } from "../NativeKnowledgeNotebookTypes";
import type { NativeNotebookModel } from "../useNativeKnowledgeNotebookModel";
export function NativeKnowledgeNotebookPractice({
  model,
}: {
  readonly model: NativeNotebookModel;
}) {
  const {
    section,
    notebook,
    onStartReview,
    busy,
    unsaved,
    mayWrite,
    runAction,
    start,
    setAnswer,
    answer,
    saveAnswerDraft,
    setConfidence,
    confidence,
    api,
    answerQuestion,
    activeTarget,
    ask,
    control,
  } = model;
  if (!notebook) return null;
  function chooseConfidence(value: "guess" | "unsure" | "confident") {
    return () => {
      setConfidence(value);
    };
  }
  return (
    <View className={section === NotebookSection.Practice ? "gap-[11px]" : "hidden"}>
      <Text className={"text-recall-ink text-[14px] font-bold"}>{notebook.goal}</Text>
      {notebook.session.phase === "finished" ? (
        <View className={"gap-[7px] py-[12px] border-t border-t-recall-line"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>Tutor practice complete</Text>
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
            {notebook.evidence.length} evidence items ·{" "}
            {notebook.proposals.filter((item) => item.status === "accepted").length} approved cards
            · {notebook.proposals.filter((item) => item.status === "pending").length} proposals to
            review
          </Text>
          {onStartReview ? (
            <NativeButton
              disabled={busy || !!unsaved}
              onPress={onStartReview}
              label="Start reviewing saved cards"
              className={
                "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
              }
              labelClassName="text-recall-surface text-[12px] font-bold"
            />
          ) : null}
        </View>
      ) : null}
      {notebook.session.phase !== "active" ? (
        <NativeButton
          disabled={busy || !mayWrite()}
          onPress={() =>
            void runAction(async (isCurrent) => {
              if (isCurrent()) await start();
            })
          }
          label="Continue tutor practice"
          className={
            "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
          }
          labelClassName="text-recall-surface text-[12px] font-bold"
        />
      ) : notebook.session.pendingQuestion ? (
        <View className={"gap-[8px] py-[12px]"}>
          {notebook.session.mode === "explain" && notebook.session.pendingQuestion.explanation ? (
            <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
              {notebook.session.pendingQuestion.explanation}
            </Text>
          ) : null}
          <Text className={"text-recall-ink font-bold text-[13px]"}>
            {notebook.session.pendingQuestion.question}
          </Text>
          {notebook.session.pendingQuestion.conceptSuggestions?.map((suggestion, index) => (
            <NativeKnowledgeNotebookSuggestedConcept
              key={`${suggestion.title}:${String(index)}`}
              model={model}
              suggestion={suggestion}
            />
          ))}
          <TextInput
            accessibilityLabel="Your answer"
            multiline
            onChangeText={setAnswer}
            value={answer}
            className={
              "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
            placeholder="Write your answer, or choose I don't know"
          />
          <NativeButton
            disabled={busy || !!unsaved || !mayWrite()}
            onPress={() =>
              void runAction(async () => {
                await saveAnswerDraft();
              })
            }
            label="Save answer draft"
            className={practiceActionClassName}
            labelClassName="text-recall-darkGreen text-[11px] font-bold"
          />
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>How sure are you?</Text>
          <View className={"flex-row flex-wrap gap-[7px]"}>
            {(["guess", "unsure", "confident"] as const).map((item) => (
              <NativeButton
                key={item}
                onPress={chooseConfidence(item)}
                label={`${confidence === item ? "✓ " : ""}${item}`}
                className={practiceActionClassName}
                labelClassName="text-recall-darkGreen text-[11px] font-bold"
              />
            ))}
          </View>
          <View className={"flex-row flex-wrap gap-[7px]"}>
            <NativeButton
              disabled={busy || !api || !mayWrite()}
              onPress={() => void answerQuestion(answer, confidence)}
              label="Submit answer"
              className={
                "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
              }
              labelClassName="text-recall-surface text-[12px] font-bold"
            />
            <NativeButton
              disabled={busy || !api || !mayWrite()}
              onPress={() => void answerQuestion("I don't know", "guess")}
              label="I don't know"
              className={practiceActionClassName}
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
            />
          </View>
          {!api ? (
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
              Connect AI in settings to check your answer.
            </Text>
          ) : null}
        </View>
      ) : (
        <View className={"gap-[8px] py-[12px]"}>
          {activeTarget && Either.isRight(activeTarget) && activeTarget.right ? (
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
              Next focus:{" "}
              {notebook.concepts.find((item) => item.id === activeTarget.right?.conceptId)?.title}
            </Text>
          ) : null}
          <NativeButton
            disabled={busy || !api || !mayWrite()}
            onPress={() => void ask()}
            label="Next question"
            className={
              "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
            }
            labelClassName="text-recall-surface text-[12px] font-bold"
          />
          {!api ? (
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
              Connect AI in settings to continue.
            </Text>
          ) : null}
        </View>
      )}
      <View className={"flex-row flex-wrap gap-[7px]"}>
        {(["deeper", "explain", "skip", "finish"] as const).map((action) => (
          <NativeButton
            key={action}
            disabled={busy || !!unsaved || !mayWrite() || notebook.session.phase !== "active"}
            onPress={() =>
              void runAction(async () => {
                await control(action);
              })
            }
            label={action}
            className={practiceActionClassName}
            labelClassName="text-recall-darkGreen text-[11px] font-bold"
          />
        ))}
      </View>
      <NativeKnowledgeNotebookConcepts model={model} />
    </View>
  );
}

function NativeKnowledgeNotebookSuggestedConcept({
  model,
  suggestion,
}: {
  readonly model: NativeNotebookModel;
  readonly suggestion: { readonly title: string; readonly description: string };
}) {
  const { busy, mayWrite, runAction, approveSuggestedConcept } = model;
  return (
    <View className={"gap-[6px] p-[8px]"}>
      <Text className={"text-recall-ink font-bold text-[13px]"}>
        Suggested concept: {suggestion.title}
      </Text>
      <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
        {suggestion.description}
      </Text>
      <NativeButton
        disabled={busy || !mayWrite()}
        onPress={() =>
          void runAction(async (isCurrent) => {
            if (isCurrent()) await approveSuggestedConcept(suggestion);
          })
        }
        label="Add suggested concept"
        className={practiceActionClassName}
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
    </View>
  );
}
