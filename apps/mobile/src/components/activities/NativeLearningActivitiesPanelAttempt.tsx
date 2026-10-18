import type { ReactNode } from "react";
import { Alert, Text, View } from "react-native";
import { NativeTextField } from "@recall/ui-native";
import { NativeButton } from "../ui/NativeButton";
import type { useLearningActivities } from "../../hooks/use-learning-activities";
import type { ActivityResult } from "@recall/domain";

export type NativeLearningActivityAttemptPanelProps = {
  readonly model: ReturnType<typeof useLearningActivities>;
  readonly objectives: readonly { readonly id: string; readonly title: string }[];
  readonly hasServices: boolean;
  readonly canSelfAssess: boolean;
  readonly canAssessHosted: boolean;
  readonly locked: boolean;
  readonly customInteraction: ReactNode;
};

function SelfScoreButtons({
  model,
  locked,
}: {
  readonly model: ReturnType<typeof useLearningActivities>;
  readonly locked: boolean;
}) {
  const scores = [
    { value: 0, label: "Needs work" },
    { value: 0.5, label: "Partially meets rubric" },
    { value: 1, label: "Meets rubric" },
  ] as const;
  return (
    <>
      {scores.map((score) => (
        <NativeButton
          key={score.value}
          label={`${model.response.selfScore === score.value ? "✓ " : ""}${score.label}`}
          tone="soft"
          disabled={locked}
          onPress={() => {
            model.setResponse((current) => ({ ...current, selfScore: score.value }));
          }}
        />
      ))}
    </>
  );
}

function EvidenceRow({
  entry,
  index,
  objectives,
}: {
  readonly entry: ActivityResult["evidence"][number];
  readonly index: number;
  readonly objectives: NativeLearningActivityAttemptPanelProps["objectives"];
}) {
  return (
    <Text key={`${entry.objectiveId}:${entry.dimension}:${String(index)}`} className="text-sm">
      {objectives.find((objective) => objective.id === entry.objectiveId)?.title ?? "Deck practice"}{" "}
      · {entry.dimension}: {Math.round(entry.score * 100)}% · {entry.assessment} ·{" "}
      {Math.round(entry.confidence * 100)}% assessment confidence ·{" "}
      {entry.assistance === "none" ? "Unaided" : "Assisted"}
      {"\n"}
      {entry.explanation}
    </Text>
  );
}

function PromptResponse({
  prompt,
  index,
  model,
  locked,
}: {
  readonly prompt: string;
  readonly index: number;
  readonly model: ReturnType<typeof useLearningActivities>;
  readonly locked: boolean;
}) {
  const presentation = model.presentation;
  return (
    <View className="gap-2">
      <Text>{prompt}</Text>
      {presentation?.options.length === 0 && (
        <NativeTextField
          label={presentation.code ? "JavaScript solution" : `Your response ${String(index + 1)}`}
          value={model.response.answers[index] ?? ""}
          editable={!locked && !model.result}
          maxLength={40_000}
          multiline
          onChangeText={(value) => {
            model.answer(index, value);
          }}
        />
      )}
    </View>
  );
}

function FinalAssessmentControls({
  model,
  canSelfAssess,
  locked,
}: {
  readonly model: ReturnType<typeof useLearningActivities>;
  readonly canSelfAssess: boolean;
  readonly locked: boolean;
}) {
  const presentation = model.presentation;
  if (!presentation || model.result) return null;
  const hasOptions = presentation.options.length > 0;
  return (
    <>
      {!hasOptions && (
        <>
          {canSelfAssess && (
            <Text className="font-bold">How does your response meet the rubric?</Text>
          )}
          {canSelfAssess && <SelfScoreButtons model={model} locked={locked} />}
          {presentation.reference && (
            <NativeButton
              label="Reveal reference (marks assistance)"
              tone="soft"
              disabled={locked}
              onPress={model.reveal}
            />
          )}
          {model.referenceShown && <Text>{presentation.reference}</Text>}
        </>
      )}
      <NativeButton
        label={hasOptions ? "Check answer" : "Review assessment"}
        disabled={
          locked ||
          (hasOptions
            ? model.response.selectedOptionIds.length === 0
            : model.response.answers.some((answer) => !answer.trim()))
        }
        onPress={model.assess}
      />
    </>
  );
}

function HostedAssessmentControls({
  model,
  canAssessHosted,
  locked,
}: {
  readonly model: ReturnType<typeof useLearningActivities>;
  readonly canAssessHosted: boolean;
  readonly locked: boolean;
}) {
  const presentation = model.presentation;
  if (!presentation || !canAssessHosted || model.result) return null;
  const ready =
    presentation.options.length === 0 && model.stage === presentation.prompts.length - 1;
  if (!ready) return null;
  const answerReady = !model.response.answers.some((answer) => !answer.trim());
  const canSuggestFollowUp =
    model.activity?.pluginId === "recall.interrogation" && presentation.prompts.length < 10;
  return (
    <View className="gap-2">
      <NativeButton
        label={presentation.code ? "Run tests" : "Request AI assessment"}
        disabled={locked || !answerReady}
        onPress={model.hostedAssess}
      />
      {canSuggestFollowUp && (
        <NativeButton
          label="Suggest AI follow-up"
          tone="soft"
          disabled={locked || !answerReady}
          onPress={model.followUp}
        />
      )}
    </View>
  );
}

export function NativeLearningActivityAttemptPanel({
  model,
  objectives,
  hasServices,
  canSelfAssess,
  canAssessHosted,
  locked,
  customInteraction,
}: NativeLearningActivityAttemptPanelProps) {
  const promptRows =
    model.presentation?.prompts
      .slice(0, model.stage + 1)
      .map((prompt, index) => (
        <PromptResponse key={index} prompt={prompt} index={index} model={model} locked={locked} />
      )) ?? [];
  const optionRows =
    model.presentation?.options.map((option) => (
      <NativeButton
        key={option.id}
        label={`${model.response.selectedOptionIds.includes(option.id) ? "✓ " : ""}${option.text}`}
        tone="soft"
        disabled={locked || !!model.result}
        onPress={() => {
          model.choose(option.id);
        }}
      />
    )) ?? [];
  const evidenceRows =
    model.result?.evidence.map((entry, index) => (
      <EvidenceRow
        key={`${entry.objectiveId}:${entry.dimension}:${String(index)}`}
        entry={entry}
        index={index}
        objectives={objectives}
      />
    )) ?? [];
  const leaveMessage = model.result
    ? "This proposed assessment will be discarded. Previously saved progress remains available."
    : "Latest unsaved changes will be discarded. Previously saved progress remains available.";
  return (
    <>
      {model.activity && model.presentation && (
        <View className="gap-3 rounded-xl border border-recall-line p-3">
          <Text className="text-base font-bold">{model.activity.title}</Text>
          {model.presentation.code && (
            <Text className="text-sm text-recall-muted">
              Write a JavaScript solve function and put any explanation in code comments.{" "}
              {hasServices
                ? "Run it in the isolated test runner, or assess it against the rubric."
                : "Assess it against the rubric. Automated tests require learning services."}
            </Text>
          )}
          {model.activity.pluginId === "recall.interrogation" && (
            <Text className="text-sm text-recall-muted">
              Answer the staged questions and assess your explanation against the rubric.{" "}
              {hasServices
                ? "You can request an AI follow-up or assessment. AI suggestions require your approval."
                : "AI follow-ups and assessment require learning services."}
            </Text>
          )}
          {customInteraction}
          {!customInteraction && promptRows}
          {!customInteraction && optionRows}
          <Text className="text-sm">Rubric: {model.presentation.rubric}</Text>
          {!model.result && model.stage < model.presentation.prompts.length - 1 ? (
            <NativeButton
              label="Next question"
              disabled={locked || !model.response.answers[model.stage]?.trim()}
              onPress={() => {
                model.setStage((current) => current + 1);
              }}
            />
          ) : (
            <FinalAssessmentControls model={model} canSelfAssess={canSelfAssess} locked={locked} />
          )}
          <HostedAssessmentControls
            model={model}
            canAssessHosted={canAssessHosted}
            locked={locked}
          />
          {model.suggestedQuestion && !model.result && (
            <View className="gap-2">
              <Text>Suggested question: {model.suggestedQuestion}</Text>
              <NativeButton
                label="Use this follow-up"
                disabled={locked}
                onPress={model.approveQuestion}
              />
              <NativeButton
                label="Dismiss follow-up"
                tone="soft"
                disabled={locked}
                onPress={model.dismissQuestion}
              />
            </View>
          )}
          {model.result && (
            <View className="gap-2">
              <Text accessibilityRole="alert">{model.result.feedback}</Text>
              <Text className="text-sm text-recall-muted">
                Proposed assessment · {model.result.evaluatorId} · version{" "}
                {model.result.evaluatorVersion}. Review it before recording.
              </Text>
              {evidenceRows}
              <NativeButton
                label="Accept and record attempt"
                disabled={locked}
                onPress={model.accept}
              />
              <NativeButton
                label="Revise response"
                tone="soft"
                disabled={locked}
                onPress={model.revise}
              />
            </View>
          )}
          <NativeButton
            label="Save progress and close"
            tone="soft"
            disabled={locked || !!model.result}
            onPress={model.keep}
          />
          {model.result && (
            <Text className="text-sm text-recall-muted">
              Record this assessment or revise your response before saving progress.
            </Text>
          )}
          <NativeButton
            label="Leave attempt"
            tone="soft"
            disabled={locked}
            onPress={() => {
              Alert.alert("Leave this attempt?", leaveMessage, [
                { text: "Continue", style: "cancel" },
                { text: "Leave", style: "destructive", onPress: model.leave },
              ]);
            }}
          />
        </View>
      )}
    </>
  );
}
