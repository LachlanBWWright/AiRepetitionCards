import type { ActivityResponse, LearningActivity } from "@recall/domain";
import { useState, type ReactNode } from "react";
import { Alert, Text, View } from "react-native";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import { NativeButton } from "./ui/NativeButton";
import { findActivityPlugin, summarizeUnderstanding } from "@recall/application";
import {
  useLearningActivities,
  type LearningActivitiesProps,
} from "../hooks/use-learning-activities";

export function NativeLearningActivitiesPanel(
  props: LearningActivitiesProps & {
    readonly renderInteraction?: (input: {
      readonly activity: LearningActivity;
      readonly response: ActivityResponse;
      readonly disabled: boolean;
      readonly onChange: (response: ActivityResponse) => void;
    }) => ReactNode;
  },
) {
  const model = useLearningActivities({ ...props, platform: "native" });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(20);
  const locked = props.disabled || model.busy;
  const customInteraction = model.activity
    ? props.renderInteraction?.({
        activity: model.activity,
        response: model.response,
        disabled: Boolean(locked || model.result),
        onChange: model.setResponse,
      })
    : null;
  const activities = model.library.activities.filter(
    (activity) => activity.areaId === props.areaId,
  );
  const attempts = model.library.attempts.filter(
    (attempt) => attempt.activity.areaId === props.areaId,
  );
  const choices = Array.from(
    new Map(
      model.registry
        .filter(
          (plugin) =>
            plugin.capabilities.platforms.includes("native") &&
            (!["recall.basic", "recall.cloze"].includes(plugin.id) ||
              plugin.id === model.editing?.pluginId),
        )
        .map((plugin) => [plugin.id, plugin]),
    ).values(),
  );
  const activePlugin = model.activity
    ? findActivityPlugin(model.registry, model.activity)
    : undefined;
  const canSelfAssess =
    activePlugin?.capabilities.assessment === "self" ||
    activePlugin?.capabilities.assessmentMethods?.includes("self") === true;
  const canAssessHosted =
    !!props.services &&
    !!activePlugin &&
    (activePlugin.capabilities.assessment === "ai" ||
      activePlugin.capabilities.assessmentMethods?.some(
        (method) => method === "ai" || method === "deterministic",
      ));
  return (
    <View className="gap-3 rounded-xl border border-recall-line bg-recall-surface p-4">
      <Text accessibilityRole="header" className="text-lg font-bold">
        Learning activities
      </Text>
      <Text className="text-sm text-recall-muted">
        Deeper practice against your objectives. {attempts.length} accepted attempts. Saved only on
        this device and included in private workspace backups.
        {props.services ? " Synchronize to keep your account copy up to date." : ""} Review
        schedules remain separate.
      </Text>
      {props.services && (
        <NativeButton
          label="Synchronize activities"
          tone="soft"
          disabled={locked || !!model.activity || model.creating}
          onPress={model.sync}
        />
      )}
      {model.editorDrafts.map((draft) => (
        <NativeButton
          key={draft.id}
          label={`Resume activity draft: ${draft.title || "Untitled"}`}
          tone="soft"
          disabled={locked || !!model.activity || model.creating}
          onPress={() => model.resumeEditor(draft.id)}
        />
      ))}
      {props.cards && props.cards.length > 0 && !model.activity && !model.creating && (
        <NativeSelect
          label="Practice an existing card"
          value=""
          disabled={locked}
          options={[
            { value: "", label: "Choose a card" },
            ...props.cards.map((card) => ({ value: card.id, label: card.front })),
          ]}
          onValueChange={(id) => {
            const card = props.cards?.find((entry) => entry.id === id);
            if (card) model.wrapCard(card);
          }}
        />
      )}
      {model.drafts.map((draft) => (
        <NativeButton
          key={draft.id}
          label={`Resume: ${draft.activity.title}`}
          tone="soft"
          disabled={
            locked ||
            !!model.activity ||
            model.creating ||
            !findActivityPlugin(model.registry, draft.activity)?.capabilities.platforms.includes(
              "native",
            )
          }
          onPress={() => model.resume(draft.id)}
        />
      ))}
      {!model.activity && model.recommendations[0] && (
        <Text className="text-sm text-recall-muted">
          Suggested next: {model.recommendations[0].activity.title} · about{" "}
          {model.recommendations[0].estimatedMinutes} minutes · {model.recommendations[0].reason}
        </Text>
      )}
      {model.message && <Text accessibilityRole="alert">{model.message}</Text>}
      <NativeButton
        label="New activity"
        tone="soft"
        disabled={locked || !!model.activity || model.creating}
        onPress={model.newActivity}
      />
      {model.creating && (
        <View className="gap-3 rounded-xl border border-recall-line p-3">
          <NativeSelect
            label="Activity type"
            value={model.pluginId}
            onValueChange={model.selectPlugin}
            options={choices.map((plugin) => ({ value: plugin.id, label: plugin.label }))}
            disabled={locked}
          />
          <NativeTextField
            label="Activity title"
            value={model.title}
            onChangeText={model.setTitle}
            editable={!locked}
            maxLength={300}
          />
          {props.objectives.length > 0 && (
            <NativeSelect
              label="Learning objective"
              value={model.objectiveId}
              onValueChange={model.setObjectiveId}
              options={props.objectives.map((objective) => ({
                value: objective.id,
                label: objective.title,
              }))}
              disabled={locked}
            />
          )}
          {model.authorFields.map((field) => (
            <NativeTextField
              key={field.key}
              label={field.label}
              value={model.fieldValue(field.key)}
              onChangeText={(value) =>
                model.setFields((current) => ({ ...current, [field.key]: value }))
              }
              editable={!locked}
              multiline={field.multiline}
              maxLength={field.key === "payload" ? 100_000 : 20_000}
            />
          ))}
          <NativeButton
            label={model.editing ? "Save activity changes" : "Save activity"}
            disabled={locked || !model.title.trim()}
            onPress={model.create}
          />
          <NativeButton
            label="Save draft and close"
            tone="soft"
            disabled={locked}
            onPress={model.closeEditor}
          />
        </View>
      )}
      {model.activity && model.presentation && (
        <View className="gap-3 rounded-xl border border-recall-line p-3">
          <Text className="text-base font-bold">{model.activity.title}</Text>
          {model.presentation.code && (
            <Text className="text-sm text-recall-muted">
              Write a JavaScript solve function and put any explanation in code comments.{" "}
              {props.services
                ? "Run it in the isolated test runner, or assess it against the rubric."
                : "Assess it against the rubric. Automated tests require learning services."}
            </Text>
          )}
          {model.activity.pluginId === "recall.interrogation" && (
            <Text className="text-sm text-recall-muted">
              Answer the staged questions and assess your explanation against the rubric.{" "}
              {props.services
                ? "You can request an AI follow-up or assessment. AI suggestions require your approval."
                : "AI follow-ups and assessment require learning services."}
            </Text>
          )}
          {customInteraction}
          {!customInteraction &&
            model.presentation.prompts.map(
              (prompt, index) =>
                index <= model.stage && (
                  <View key={index} className="gap-2">
                    <Text>{prompt}</Text>
                    {model.presentation?.options.length === 0 && (
                      <NativeTextField
                        label={
                          model.presentation?.code
                            ? "JavaScript solution"
                            : `Your response ${index + 1}`
                        }
                        value={model.response.answers[index] ?? ""}
                        editable={!locked && !model.result}
                        maxLength={40_000}
                        multiline
                        onChangeText={(value) => model.answer(index, value)}
                      />
                    )}
                  </View>
                ),
            )}
          {!customInteraction &&
            model.presentation.options.map((option) => (
              <NativeButton
                key={option.id}
                label={`${model.response.selectedOptionIds.includes(option.id) ? "✓ " : ""}${option.text}`}
                tone="soft"
                disabled={locked || !!model.result}
                onPress={() => model.choose(option.id)}
              />
            ))}
          <Text className="text-sm">Rubric: {model.presentation.rubric}</Text>
          {!model.result && model.stage < model.presentation.prompts.length - 1 ? (
            <NativeButton
              label="Next question"
              disabled={locked || !model.response.answers[model.stage]?.trim()}
              onPress={() => model.setStage((current) => current + 1)}
            />
          ) : (
            !model.result && (
              <>
                {model.presentation.options.length === 0 && (
                  <>
                    {canSelfAssess && (
                      <Text className="font-bold">How does your response meet the rubric?</Text>
                    )}
                    {canSelfAssess &&
                      [
                        { value: 0, label: "Needs work" },
                        { value: 0.5, label: "Partially meets rubric" },
                        { value: 1, label: "Meets rubric" },
                      ].map((score) => (
                        <NativeButton
                          key={score.value}
                          label={`${model.response.selfScore === score.value ? "✓ " : ""}${score.label}`}
                          tone="soft"
                          disabled={locked}
                          onPress={() =>
                            model.setResponse((current) => ({ ...current, selfScore: score.value }))
                          }
                        />
                      ))}
                    {model.presentation.reference && (
                      <NativeButton
                        label="Reveal reference (marks assistance)"
                        tone="soft"
                        disabled={locked}
                        onPress={model.reveal}
                      />
                    )}
                    {model.referenceShown && <Text>{model.presentation.reference}</Text>}
                  </>
                )}
                <NativeButton
                  label={model.presentation.options.length ? "Check answer" : "Review assessment"}
                  disabled={
                    locked ||
                    (model.presentation.options.length
                      ? model.response.selectedOptionIds.length === 0
                      : model.response.answers.some((answer) => !answer.trim()))
                  }
                  onPress={model.assess}
                />
              </>
            )
          )}
          {!model.result &&
            canAssessHosted &&
            model.presentation.options.length === 0 &&
            model.stage === model.presentation.prompts.length - 1 && (
              <View className="gap-2">
                <NativeButton
                  label={model.presentation.code ? "Run tests" : "Request AI assessment"}
                  disabled={locked || model.response.answers.some((answer) => !answer.trim())}
                  onPress={model.hostedAssess}
                />
                {model.activity.pluginId === "recall.interrogation" &&
                  model.presentation.prompts.length < 10 && (
                    <NativeButton
                      label="Suggest AI follow-up"
                      tone="soft"
                      disabled={locked || model.response.answers.some((answer) => !answer.trim())}
                      onPress={model.followUp}
                    />
                  )}
              </View>
            )}
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
              {model.result.evidence.map((entry, index) => (
                <Text key={`${entry.objectiveId}:${entry.dimension}:${index}`} className="text-sm">
                  {props.objectives.find((objective) => objective.id === entry.objectiveId)
                    ?.title ?? "Deck practice"}{" "}
                  · {entry.dimension}: {Math.round(entry.score * 100)}% · {entry.assessment} ·{" "}
                  {Math.round(entry.confidence * 100)}% assessment confidence ·{" "}
                  {entry.assistance === "none" ? "Unaided" : "Assisted"}
                  {"\n"}
                  {entry.explanation}
                </Text>
              ))}
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
            onPress={() =>
              Alert.alert(
                "Leave this attempt?",
                model.result
                  ? "This proposed assessment will be discarded. Previously saved progress remains available."
                  : "Latest unsaved changes will be discarded. Previously saved progress remains available.",
                [
                  { text: "Continue", style: "cancel" },
                  { text: "Leave", style: "destructive", onPress: model.leave },
                ],
              )
            }
          />
        </View>
      )}
      {!model.activity &&
        activities.map((activity) => (
          <View key={activity.id} className="gap-2 rounded-xl border border-recall-line p-3">
            <Text className="font-bold">{activity.title}</Text>
            <Text className="text-sm text-recall-muted">{activity.fallback}</Text>
            <NativeButton
              label={
                findActivityPlugin(model.registry, activity)?.capabilities.platforms.includes(
                  "native",
                )
                  ? "Start activity"
                  : "Activity unavailable on this platform"
              }
              tone="soft"
              disabled={
                locked ||
                model.creating ||
                activity.archived === true ||
                !findActivityPlugin(model.registry, activity)?.capabilities.platforms.includes(
                  "native",
                )
              }
              onPress={() => model.start(activity)}
            />
            <NativeButton
              label="Edit activity"
              tone="soft"
              disabled={
                locked ||
                model.creating ||
                !findActivityPlugin(model.registry, activity)?.capabilities.platforms.includes(
                  "native",
                )
              }
              onPress={() => model.edit(activity)}
            />
            <NativeButton
              label={activity.archived ? "Restore activity" : "Archive activity"}
              tone="soft"
              disabled={locked || model.creating}
              onPress={() => model.archive(activity)}
            />
          </View>
        ))}
      {activities.length === 0 && !model.creating && (
        <Text className="text-sm text-recall-muted">
          Add a multiple-choice question, a rubric-based exercise, or a coding challenge.
        </Text>
      )}
      {attempts.length > 0 && (
        <NativeButton
          label={`Attempt history (${attempts.length})`}
          tone="soft"
          onPress={() => setHistoryOpen((current) => !current)}
        />
      )}
      {historyOpen &&
        attempts
          .slice()
          .reverse()
          .slice(0, historyLimit)
          .map((attempt) => (
            <View key={attempt.id} className="gap-2 rounded-xl border border-recall-line p-3">
              <Text className="font-bold">
                {attempt.activity.title} · {new Date(attempt.acceptedAt).toLocaleString()}
              </Text>
              {attempt.response.answers.map((answer, index) => (
                <View key={index}>
                  <Text className="text-sm font-bold">
                    {attempt.response.presentedPrompts?.[index] ?? attempt.activity.fallback}
                  </Text>
                  <Text className="text-sm">{answer}</Text>
                </View>
              ))}
              {attempt.response.selectedOptionIds.length > 0 && (
                <Text className="text-sm">
                  Selected choices: {attempt.response.selectedOptionIds.join(", ")}
                </Text>
              )}
              <Text className="text-sm">{attempt.result.feedback}</Text>
              {attempt.result.evidence.map((evidence, index) => (
                <Text key={index} className="text-sm text-recall-muted">
                  {evidence.dimension}: {Math.round(evidence.score * 100)}% · {evidence.assessment}{" "}
                  · {Math.round(evidence.confidence * 100)}% assessment confidence
                </Text>
              ))}
              <Text className="text-sm text-recall-muted">
                {attempt.response.assistance === "none" ? "Unaided" : "Assisted"} · Original
                activity revision {attempt.activity.revision}
              </Text>
            </View>
          ))}
      {historyOpen && attempts.length > historyLimit && (
        <NativeButton
          label="Show more attempts"
          tone="soft"
          onPress={() => setHistoryLimit((count) => count + 20)}
        />
      )}
      {Array.from(
        new Set([
          ...activities.flatMap((activity) => activity.objectiveIds),
          ...attempts.flatMap((attempt) => attempt.activity.objectiveIds),
        ]),
      ).map((objectiveId) => (
        <View key={objectiveId} className="gap-1">
          <Text className="text-sm font-bold">
            {props.objectives.find((objective) => objective.id === objectiveId)?.title ??
              "Deck practice"}
          </Text>
          {summarizeUnderstanding(attempts, objectiveId)
            .filter((dimension) => dimension.attempts > 0)
            .map((dimension) => (
              <Text key={dimension.dimension} className="text-sm text-recall-muted">
                {dimension.dimension}:{" "}
                {dimension.value === null
                  ? "No independent estimate"
                  : `${Math.round(dimension.value * 100)}% observed score`}{" "}
                · {dimension.selfReports} self reports · {dimension.assisted} assisted. This is
                evidence, not a mastery guarantee.
              </Text>
            ))}
        </View>
      ))}
    </View>
  );
}
