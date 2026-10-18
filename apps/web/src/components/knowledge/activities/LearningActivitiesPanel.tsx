"use client";
import { Button as ShadcnButton } from "@recall/ui-web/components/button";
import { LearningActivityCardSelect } from "./LearningActivityCardSelect";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@recall/ui-web/components/collapsible";
import type { ActivityResponse, LearningActivity } from "@recall/domain";
import { useState, type ChangeEvent, type ReactNode } from "react";
import { Button, Input, Label, Textarea } from "@recall/ui-web";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { diagnoseLearningObjectives } from "@recall/application";
import { ObjectiveDiagnostics } from "./ObjectiveDiagnostics";
import { LearningActivitiesPanelAttempt } from "./LearningActivitiesPanelAttempt";
import { ActivityAttemptHistory } from "./LearningActivitiesPanelAttemptHistory";
import { WebActivityPluginTools } from "./ActivityPluginTools";
import { OfflineReliabilityStatus } from "../../ui/OfflineReliabilityStatus";
import { LearningActivityLibraryRow } from "./LearningActivityLibraryRow";
import {
  useLearningActivities,
  type LearningActivitiesProps,
} from "../../../hooks/use-learning-activities";

export function LearningActivitiesPanel(
  props: LearningActivitiesProps & {
    readonly renderContainer?: (content: ReactNode) => ReactNode;
    readonly renderInteraction?: (input: {
      readonly activity: LearningActivity;
      readonly response: ActivityResponse;
      readonly disabled: boolean;
      readonly onChange: (response: ActivityResponse) => void;
    }) => ReactNode;
  },
) {
  const model = useLearningActivities(props);
  const [leaving, setLeaving] = useState(false);
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
  const choices = model.registry.filter(
    (plugin) =>
      plugin.capabilities.platforms.includes("web") &&
      (model.editing?.pluginId === plugin.id ||
        !["recall.basic", "recall.cloze"].includes(plugin.id)),
  );
  const uniqueChoices = choices.filter(
    (plugin, index) => choices.findIndex((entry) => entry.id === plugin.id) === index,
  );
  const acceptsSelfAssessment =
    model.activePlugin?.capabilities.assessment === "self" ||
    model.activePlugin?.capabilities.assessmentMethods?.includes("self");
  const canHostAssessment =
    !!model.activity &&
    [
      "recall.basic",
      "recall.cloze",
      "recall.short-answer",
      "recall.interrogation",
      "recall.coding",
    ].includes(model.activity.pluginId);
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
  const startActivity = (activity: LearningActivity) => {
    model.start(activity);
  };
  const editActivity = (activity: LearningActivity) => {
    model.edit(activity);
  };
  const archiveActivity = (activity: LearningActivity) => {
    model.archive(activity);
  };
  const activityCards = !model.activity
    ? activities.map((activity) => (
        <LearningActivityLibraryRow
          key={activity.id}
          activity={activity}
          registry={model.registry}
          disabled={locked}
          creating={model.creating}
          onStart={startActivity}
          onEdit={editActivity}
          onArchive={archiveActivity}
        />
      ))
    : null;
  const existingCardSelect =
    props.cards && props.cards.length > 0 ? (
      <LearningActivityCardSelect cards={props.cards} disabled={locked} onSelect={model.wrapCard} />
    ) : null;
  const content = (
    <section
      aria-label="Learning activities"
      className={props.renderContainer ? "grid gap-5" : "grid gap-4 rounded-xl border bg-card p-4"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {!props.renderContainer && <h2 className="text-lg font-semibold">Learning activities</h2>}
          <p className="text-sm text-muted-foreground">
            Deeper practice with evidence against your objectives. {attempts.length} accepted
            attempts.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={locked || !!model.activity || model.creating}
          onClick={model.newActivity}
        >
          New activity
        </Button>
      </div>
      <OfflineReliabilityStatus
        status={props.persistenceStatus ?? model.syncStatus}
        storageLocation={props.storageLocation ?? "tab"}
      />
      <Collapsible className="rounded-lg border">
        <CollapsibleTrigger asChild>
          <ShadcnButton
            variant="secondary"
            className="group w-full justify-between border-0 bg-transparent px-4 shadow-none"
          >
            Advanced activity tools
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-data-[state=open]:rotate-180"
            />
          </ShadcnButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-4">
          <WebActivityPluginTools
            library={model.library}
            registry={model.registry}
            areaId={props.areaId}
            objectiveId={props.objectives[0]?.id ?? `area:${props.areaId}:practice`}
            createId={props.createId}
            platform="web"
            onSave={props.onSave}
            disabled={locked}
          />
        </CollapsibleContent>
      </Collapsible>
      {props.services && (
        <Button
          variant="secondary"
          disabled={locked || !!model.activity || model.creating}
          onClick={model.sync}
        >
          Synchronize activities
        </Button>
      )}
      {model.editorDrafts.map((draft) => (
        <Button
          key={draft.id}
          variant="secondary"
          disabled={locked || !!model.activity || model.creating}
          onClick={() => {
            model.resumeEditor(draft.id);
          }}
        >
          Resume activity draft: {draft.title || "Untitled"}
        </Button>
      ))}
      {!model.activity && !model.creating && existingCardSelect}
      {model.drafts.map((draft) => (
        <Button
          key={draft.id}
          variant="secondary"
          disabled={locked || !!model.activity || model.creating}
          onClick={() => {
            model.resume(draft.id);
          }}
        >
          Resume: {draft.activity.title}
        </Button>
      ))}
      {!model.activity && model.recommendations[0] && (
        <p className="text-sm text-muted-foreground">
          Suggested next: {model.recommendations[0].activity.title} · about{" "}
          {model.recommendations[0].estimatedMinutes} minutes · {model.recommendations[0].reason}
        </p>
      )}
      {model.message && (
        <p role="status" className="text-sm">
          {model.message}
        </p>
      )}
      {model.creating && (
        <div className="grid gap-3 rounded-lg border p-4">
          <Label htmlFor="activity-type">Activity type</Label>
          <Select
            value={model.pluginId}
            onValueChange={model.selectPlugin}
            disabled={locked || !!model.editing}
          >
            <SelectTrigger id="activity-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{uniqueChoices.map(renderPluginChoice)}</SelectContent>
          </Select>
          <Label htmlFor="activity-title">Activity title</Label>
          <Input
            id="activity-title"
            value={model.title}
            disabled={locked}
            maxLength={300}
            onChange={(event) => {
              model.setTitle(event.target.value);
            }}
          />
          {props.objectives.length > 0 && (
            <>
              <Label htmlFor="activity-objective">Learning objective</Label>
              <ActivityObjectiveSelect
                objectiveId={model.objectiveId}
                objectives={props.objectives}
                disabled={locked}
                onChange={model.setObjectiveId}
              />
            </>
          )}
          {model.authorFields.map((field) =>
            renderActivityAuthorField({
              field,
              value: model.fieldValue(field.key),
              disabled: locked,
              onChange: (value) => {
                model.setFields((current) => ({ ...current, [field.key]: value }));
              },
            }),
          )}
          <div className="flex gap-2">
            <Button disabled={locked || !model.title.trim()} onClick={model.create}>
              {model.editing ? "Save activity changes" : "Save activity"}
            </Button>
            <Button variant="secondary" disabled={locked} onClick={model.closeEditor}>
              Save draft and close
            </Button>
          </div>
        </div>
      )}
      <LearningActivitiesPanelAttempt
        model={model}
        locked={locked}
        customInteraction={customInteraction}
        acceptsSelfAssessment={Boolean(acceptsSelfAssessment)}
        canHostAssessment={canHostAssessment}
        hasServices={Boolean(props.services)}
        leaving={leaving}
        onLeavingChange={setLeaving}
      />
      {activityCards}
      {activities.length === 0 && !model.creating && (
        <p className="text-sm text-muted-foreground">
          Add a multiple-choice question, a rubric-based exercise, or a coding challenge.
        </p>
      )}
      <ActivityAttemptHistory
        attempts={attempts}
        historyLimit={historyLimit}
        onShowMore={() => {
          setHistoryLimit((count) => count + 20);
        }}
      />
      <ObjectiveDiagnostics diagnostics={diagnostics} />
    </section>
  );
  return props.renderContainer ? props.renderContainer(content) : content;
}

function ActivityObjectiveSelect({
  objectiveId,
  objectives,
  disabled,
  onChange,
}: {
  readonly objectiveId: string;
  readonly objectives: LearningActivitiesProps["objectives"];
  readonly disabled: boolean;
  readonly onChange: (objectiveId: string) => void;
}) {
  return (
    <Select value={objectiveId} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id="activity-objective">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!objectives.some((objective) => objective.id === objectiveId) && (
          <SelectItem value={objectiveId}>Original objective</SelectItem>
        )}
        {objectives.map((objective) => (
          <SelectItem key={objective.id} value={objective.id}>
            {objective.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type ActivityAuthorField = ReturnType<typeof useLearningActivities>["authorFields"][number];
function renderPluginChoice(plugin: { readonly id: string; readonly label: string }) {
  return (
    <SelectItem key={plugin.id} value={plugin.id}>
      {plugin.label}
    </SelectItem>
  );
}

function renderActivityAuthorField({
  field,
  value,
  disabled,
  onChange,
}: {
  readonly field: ActivityAuthorField;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  const inputProps = {
    id: `activity-field-${field.key}`,
    disabled,
    value,
    maxLength: field.key === "payload" ? 100_000 : 20_000,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(event.target.value);
    },
  };
  return (
    <div key={field.key} className="grid gap-2">
      <Label htmlFor={inputProps.id}>{field.label}</Label>
      {field.multiline ? <Textarea {...inputProps} /> : <Input {...inputProps} />}
    </div>
  );
}
