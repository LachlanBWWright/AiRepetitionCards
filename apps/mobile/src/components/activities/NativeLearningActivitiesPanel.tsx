import type { ActivityResponse, LearningActivity, LearningAttempt } from "@recall/domain";
import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import { NativeButton } from "../ui/NativeButton";
import { NativeLearningActivityAttemptPanel } from "./NativeLearningActivitiesPanelAttempt";
import { diagnoseLearningObjectives, findActivityPlugin } from "@recall/application";
import { NativeObjectiveDiagnostics } from "../review/NativeObjectiveDiagnostics";
import { NativeActivityPluginTools } from "./ActivityPluginTools";
import { NativeOfflineReliabilityStatus } from "../workspace/NativeOfflineReliabilityStatus";
import {
  useLearningActivities,
  type LearningActivitiesProps,
} from "../../hooks/use-learning-activities";

function activityAvailabilityLabel(
  activity: LearningActivity,
  registry: ReturnType<typeof useLearningActivities>["registry"],
): string {
  return findActivityPlugin(registry, activity)?.capabilities.platforms.includes("native")
    ? "Start activity"
    : "Activity unavailable on this platform";
}

function isActivityAvailableOnNative(
  activity: LearningActivity,
  registry: ReturnType<typeof useLearningActivities>["registry"],
): boolean {
  return findActivityPlugin(registry, activity)?.capabilities.platforms.includes("native") ?? false;
}

function AttemptHistoryRow({ attempt }: { readonly attempt: LearningAttempt }) {
  return (
    <View className="gap-2 rounded-xl border border-recall-line p-3">
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
          {evidence.dimension}: {Math.round(evidence.score * 100)}% · {evidence.assessment} ·{" "}
          {Math.round(evidence.confidence * 100)}% assessment confidence
        </Text>
      ))}
      <Text className="text-sm text-recall-muted">
        {attempt.response.assistance === "none" ? "Unaided" : "Assisted"} · Original activity
        revision {attempt.activity.revision}
      </Text>
    </View>
  );
}

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
  const locked = props.disabled === true || model.busy;
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
  const objectiveIds = Array.from(
    new Set([
      ...props.objectives.map((objective) => objective.id),
      ...activities.flatMap((activity) => activity.objectiveIds),
      ...attempts.flatMap((attempt) => attempt.activity.objectiveIds),
    ]),
  );
  const diagnostics = diagnoseLearningObjectives(
    objectiveIds.map((objectiveId) => ({
      id: objectiveId,
      title:
        props.objectives.find((objective) => objective.id === objectiveId)?.title ??
        "Deck practice",
    })),
    attempts,
    new Date().toISOString(),
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
      <NativeOfflineReliabilityStatus status={model.syncStatus} />
      <NativeActivityPluginTools
        library={model.library}
        registry={model.registry}
        areaId={props.areaId}
        objectiveId={props.objectives[0]?.id ?? `area:${props.areaId}:practice`}
        createId={props.createId}
        platform="native"
        onSave={props.onSave}
        disabled={locked}
      />
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
          onPress={() => {
            model.resumeEditor(draft.id);
          }}
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
          onPress={() => {
            model.resume(draft.id);
          }}
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
              onChangeText={(value) => {
                model.setFields((current) => ({ ...current, [field.key]: value }));
              }}
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
      <NativeLearningActivityAttemptPanel
        model={model}
        objectives={props.objectives}
        hasServices={!!props.services}
        canSelfAssess={canSelfAssess}
        canAssessHosted={!!canAssessHosted}
        locked={locked}
        customInteraction={customInteraction}
      />
      {!model.activity &&
        activities.map((activity) => (
          <View key={activity.id} className="gap-2 rounded-xl border border-recall-line p-3">
            <Text className="font-bold">{activity.title}</Text>
            <Text className="text-sm text-recall-muted">{activity.fallback}</Text>
            <NativeButton
              label={activityAvailabilityLabel(activity, model.registry)}
              tone="soft"
              disabled={
                locked ||
                model.creating ||
                activity.archived === true ||
                !isActivityAvailableOnNative(activity, model.registry)
              }
              onPress={() => {
                model.start(activity);
              }}
            />
            <NativeButton
              label="Edit activity"
              tone="soft"
              disabled={
                locked || model.creating || !isActivityAvailableOnNative(activity, model.registry)
              }
              onPress={() => {
                model.edit(activity);
              }}
            />
            <NativeButton
              label={activity.archived ? "Restore activity" : "Archive activity"}
              tone="soft"
              disabled={locked || model.creating}
              onPress={() => {
                model.archive(activity);
              }}
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
          label={`Attempt history (${String(attempts.length)})`}
          tone="soft"
          onPress={() => {
            setHistoryOpen((current) => !current);
          }}
        />
      )}
      {historyOpen &&
        attempts
          .slice()
          .reverse()
          .slice(0, historyLimit)
          .map((attempt) => <AttemptHistoryRow key={attempt.id} attempt={attempt} />)}
      {historyOpen && attempts.length > historyLimit && (
        <NativeButton
          label="Show more attempts"
          tone="soft"
          onPress={() => {
            setHistoryLimit((count) => count + 20);
          }}
        />
      )}
      <NativeObjectiveDiagnostics diagnostics={diagnostics} />
    </View>
  );
}
