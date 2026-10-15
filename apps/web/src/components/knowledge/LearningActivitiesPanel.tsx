"use client";
import type { ActivityResponse, LearningActivity } from "@recall/domain";
import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@recall/ui-web/components/alert-dialog";
import { Button, Checkbox, Input, Label, Textarea } from "@recall/ui-web";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { findActivityPlugin, summarizeUnderstanding } from "@recall/application";
import {
  useLearningActivities,
  type LearningActivitiesProps,
} from "../../hooks/use-learning-activities";

export function LearningActivitiesPanel(
  props: LearningActivitiesProps & {
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
  return (
    <section aria-label="Learning activities" className="grid gap-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Learning activities</h2>
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
      <p className="text-sm text-muted-foreground">
        Activities and evidence are included in private workspace backups. Signed-in web activities
        persist in your account; demo activities stay in this tab. Review schedules remain separate.
      </p>
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
          onClick={() => model.resumeEditor(draft.id)}
        >
          Resume activity draft: {draft.title || "Untitled"}
        </Button>
      ))}
      {props.cards && props.cards.length > 0 && !model.activity && !model.creating && (
        <>
          <Label htmlFor="activity-existing-card">Practice an existing card</Label>
          <Select
            value=""
            disabled={locked}
            onValueChange={(id) => {
              const card = props.cards?.find((entry) => entry.id === id);
              if (card) model.wrapCard(card);
            }}
          >
            <SelectTrigger id="activity-existing-card">
              <SelectValue placeholder="Choose a card" />
            </SelectTrigger>
            <SelectContent>
              {props.cards.map((card) => (
                <SelectItem key={card.id} value={card.id}>
                  {card.front}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
      {model.drafts.map((draft) => (
        <Button
          key={draft.id}
          variant="secondary"
          disabled={locked || !!model.activity || model.creating}
          onClick={() => model.resume(draft.id)}
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
            <SelectContent>
              {uniqueChoices.map((plugin) => (
                <SelectItem key={plugin.id} value={plugin.id}>
                  {plugin.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label htmlFor="activity-title">Activity title</Label>
          <Input
            id="activity-title"
            value={model.title}
            disabled={locked}
            maxLength={300}
            onChange={(event) => model.setTitle(event.target.value)}
          />
          {props.objectives.length > 0 && (
            <>
              <Label htmlFor="activity-objective">Learning objective</Label>
              <Select
                value={model.objectiveId}
                onValueChange={model.setObjectiveId}
                disabled={locked}
              >
                <SelectTrigger id="activity-objective">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!props.objectives.some((objective) => objective.id === model.objectiveId) && (
                    <SelectItem value={model.objectiveId}>Original objective</SelectItem>
                  )}
                  {props.objectives.map((objective) => (
                    <SelectItem key={objective.id} value={objective.id}>
                      {objective.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {model.authorFields.map((field) => (
            <div key={field.key} className="grid gap-2">
              <Label htmlFor={`activity-field-${field.key}`}>{field.label}</Label>
              {field.multiline ? (
                <Textarea
                  id={`activity-field-${field.key}`}
                  disabled={locked}
                  value={model.fieldValue(field.key)}
                  maxLength={field.key === "payload" ? 100_000 : 20_000}
                  onChange={(event) =>
                    model.setFields((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              ) : (
                <Input
                  id={`activity-field-${field.key}`}
                  disabled={locked}
                  value={model.fieldValue(field.key)}
                  maxLength={field.key === "payload" ? 100_000 : 20_000}
                  onChange={(event) =>
                    model.setFields((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              )}
            </div>
          ))}
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
      {model.activity && model.presentation && (
        <div className="grid gap-3 rounded-lg border p-4">
          <h3 className="font-semibold">{model.activity.title}</h3>
          {model.presentation.code && (
            <p className="text-sm text-muted-foreground">
              Write a JavaScript solve function. Run it in the isolated test runner, or assess it
              against the rubric.
            </p>
          )}
          {model.activity.pluginId === "recall.interrogation" && (
            <p className="text-sm text-muted-foreground">
              Answer the staged questions, then optionally request an AI follow-up or assessment. AI
              suggestions require your approval.
            </p>
          )}
          {customInteraction}
          {!customInteraction &&
            model.presentation.prompts.map(
              (prompt, index) =>
                index <= model.stage && (
                  <div key={index} className="grid gap-2">
                    <p className="whitespace-pre-wrap">{prompt}</p>
                    {model.presentation?.options.length === 0 && (
                      <>
                        <Label htmlFor={`activity-answer-${index}`}>
                          Your response {index + 1}
                        </Label>
                        <Textarea
                          id={`activity-answer-${index}`}
                          className={model.presentation.code ? "min-h-40 font-mono" : "min-h-24"}
                          value={model.response.answers[index] ?? ""}
                          disabled={locked || !!model.result}
                          maxLength={40_000}
                          onChange={(event) => model.answer(index, event.target.value)}
                        />
                      </>
                    )}
                  </div>
                ),
            )}
          {!customInteraction &&
            model.presentation.options.map((option) => (
              <Label key={option.id} className="flex items-center gap-3">
                <Checkbox
                  checked={model.response.selectedOptionIds.includes(option.id)}
                  disabled={locked || !!model.result}
                  onCheckedChange={() => model.choose(option.id)}
                />
                {option.text}
              </Label>
            ))}
          <p className="whitespace-pre-wrap text-sm">Rubric: {model.presentation.rubric}</p>
          {model.stage < model.presentation.prompts.length - 1 ? (
            <Button
              disabled={locked || !model.response.answers[model.stage]?.trim()}
              onClick={() => model.setStage((current) => current + 1)}
            >
              Next question
            </Button>
          ) : (
            !model.result && (
              <>
                {model.presentation.options.length === 0 && (
                  <>
                    {acceptsSelfAssessment && (
                      <>
                        <Label>How does your response meet the rubric?</Label>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { value: 0, label: "Needs work" },
                            { value: 0.5, label: "Partially meets rubric" },
                            { value: 1, label: "Meets rubric" },
                          ].map((score) => (
                            <Button
                              key={score.value}
                              variant="secondary"
                              aria-pressed={model.response.selfScore === score.value}
                              disabled={locked}
                              onClick={() =>
                                model.setResponse((current) => ({
                                  ...current,
                                  selfScore: score.value,
                                }))
                              }
                            >
                              {score.label}
                            </Button>
                          ))}
                        </div>
                      </>
                    )}
                    {model.presentation.reference && (
                      <Button variant="secondary" disabled={locked} onClick={model.reveal}>
                        Reveal reference (marks assistance)
                      </Button>
                    )}
                    {model.referenceShown && (
                      <pre className="whitespace-pre-wrap text-sm">
                        {model.presentation.reference}
                      </pre>
                    )}
                  </>
                )}
                <Button disabled={locked} onClick={model.assess}>
                  {model.presentation.options.length ||
                  model.activePlugin?.capabilities.assessment === "deterministic"
                    ? "Check answer"
                    : "Review assessment"}
                </Button>
              </>
            )
          )}
          {!model.result &&
            props.services &&
            canHostAssessment &&
            model.presentation.options.length === 0 &&
            model.stage === model.presentation.prompts.length - 1 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={locked || model.response.answers.some((answer) => !answer.trim())}
                  onClick={model.hostedAssess}
                >
                  {model.presentation.code ? "Run tests" : "Request AI assessment"}
                </Button>
                {model.activity.pluginId === "recall.interrogation" &&
                  model.presentation.prompts.length < 10 && (
                    <Button
                      variant="secondary"
                      disabled={locked || model.response.answers.some((answer) => !answer.trim())}
                      onClick={model.followUp}
                    >
                      Suggest AI follow-up
                    </Button>
                  )}
              </div>
            )}
          {model.suggestedQuestion && (
            <div className="grid gap-2 rounded-lg border p-3">
              <p className="whitespace-pre-wrap">Suggested question: {model.suggestedQuestion}</p>
              <Button disabled={locked || !!model.result} onClick={model.approveQuestion}>
                Use this follow-up
              </Button>
              <Button variant="secondary" disabled={locked} onClick={model.dismissQuestion}>
                Dismiss suggestion
              </Button>
            </div>
          )}
          {model.result && (
            <div className="grid gap-2">
              <p role="status" className="whitespace-pre-wrap">
                {model.result.feedback}
              </p>
              {model.result.evidence.map((entry) => (
                <p key={`${entry.objectiveId}:${entry.dimension}`} className="text-sm">
                  {entry.dimension}: {Math.round(entry.score * 100)}% · {entry.assessment} ·{" "}
                  {entry.assistance === "none" ? "Unaided" : "Assisted"} ·{" "}
                  {Math.round(entry.confidence * 100)}% assessment confidence
                  <span className="block text-muted-foreground">{entry.explanation}</span>
                </p>
              ))}
              <p className="text-xs text-muted-foreground">
                Evaluator: {model.result.evaluatorId} · {model.result.evaluatorVersion}
              </p>
              <Button disabled={locked} onClick={model.accept}>
                Accept and record attempt
              </Button>
              <Button variant="secondary" disabled={locked} onClick={model.revise}>
                Revise response
              </Button>
            </div>
          )}
          <Button variant="secondary" disabled={locked || !!model.result} onClick={model.keep}>
            Save progress and close
          </Button>
          <Button variant="secondary" disabled={locked} onClick={() => setLeaving(true)}>
            Leave attempt
          </Button>
          <AlertDialog open={leaving} onOpenChange={setLeaving}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave this attempt?</AlertDialogTitle>
                <AlertDialogDescription>
                  Latest unsaved changes will be discarded. Previously saved progress remains
                  available.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Continue</AlertDialogCancel>
                <AlertDialogAction onClick={model.leave}>Leave</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      {!model.activity &&
        activities.map((activity) => (
          <article key={activity.id} className="grid gap-2 rounded-lg border p-3">
            <h3 className="font-semibold">
              {activity.title}
              {activity.archived ? " · Archived" : ""}
            </h3>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{activity.fallback}</p>
            <Button
              variant="secondary"
              disabled={
                locked ||
                model.creating ||
                activity.archived === true ||
                !findActivityPlugin(model.registry, activity)?.capabilities.platforms.includes(
                  "web",
                )
              }
              onClick={() => model.start(activity)}
            >
              {findActivityPlugin(model.registry, activity)?.capabilities.platforms.includes("web")
                ? "Start activity"
                : "Unavailable on web"}
            </Button>
            <Button
              variant="secondary"
              disabled={
                locked ||
                model.creating ||
                !findActivityPlugin(model.registry, activity)?.capabilities.platforms.includes(
                  "web",
                )
              }
              onClick={() => model.edit(activity)}
            >
              Edit activity
            </Button>
            <Button
              variant="secondary"
              disabled={locked || model.creating}
              onClick={() => model.archive(activity)}
            >
              {activity.archived ? "Restore activity" : "Archive activity"}
            </Button>
          </article>
        ))}
      {activities.length === 0 && !model.creating && (
        <p className="text-sm text-muted-foreground">
          Add a multiple-choice question, a rubric-based exercise, or a coding challenge.
        </p>
      )}
      {attempts.length > 0 && (
        <details className="grid gap-2 rounded-lg border p-3">
          <summary className="cursor-pointer font-semibold">
            Attempt history ({attempts.length})
          </summary>
          <div className="mt-3 grid gap-3">
            {attempts
              .slice()
              .reverse()
              .slice(0, historyLimit)
              .map((attempt) => (
                <article key={attempt.id} className="grid gap-2 rounded-lg border p-3">
                  <h3 className="font-semibold">
                    {attempt.activity.title} · {new Date(attempt.acceptedAt).toLocaleString()}
                  </h3>
                  {attempt.response.answers.map((answer, index) => (
                    <div key={index}>
                      <p className="text-sm font-medium">
                        {attempt.response.presentedPrompts?.[index] ?? attempt.activity.fallback}
                      </p>
                      <pre className="whitespace-pre-wrap text-sm">{answer}</pre>
                    </div>
                  ))}
                  {attempt.response.selectedOptionIds.length > 0 && (
                    <p className="text-sm">
                      Selected choices: {attempt.response.selectedOptionIds.join(", ")}
                    </p>
                  )}
                  <p className="text-sm">{attempt.result.feedback}</p>
                  <p className="text-sm text-muted-foreground">
                    {attempt.response.assistance === "none" ? "Unaided" : "Assisted"} · Original
                    activity revision {attempt.activity.revision}
                  </p>
                </article>
              ))}
            {attempts.length > historyLimit && (
              <Button variant="secondary" onClick={() => setHistoryLimit((count) => count + 20)}>
                Show more attempts
              </Button>
            )}
          </div>
        </details>
      )}
      {Array.from(
        new Set([
          ...activities.flatMap((activity) => activity.objectiveIds),
          ...attempts.flatMap((attempt) => attempt.activity.objectiveIds),
        ]),
      ).map((objectiveId) => (
        <div key={objectiveId} className="grid gap-1">
          <p className="text-sm font-semibold">
            {props.objectives.find((objective) => objective.id === objectiveId)?.title ??
              "Deck practice"}
          </p>
          {summarizeUnderstanding(attempts, objectiveId)
            .filter((dimension) => dimension.attempts > 0)
            .map((dimension) => (
              <p key={dimension.dimension} className="text-sm text-muted-foreground">
                {dimension.dimension}:{" "}
                {dimension.value === null
                  ? "No independent estimate"
                  : `${Math.round(dimension.value * 100)}% observed score`}{" "}
                · {dimension.selfReports} self reports · {dimension.assisted} assisted. This is
                evidence, not a mastery guarantee.
              </p>
            ))}
        </div>
      ))}
    </section>
  );
}
