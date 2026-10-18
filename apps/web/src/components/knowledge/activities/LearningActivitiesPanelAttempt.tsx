import type { Dispatch, ReactNode, SetStateAction } from "react";
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
import { Button, Checkbox, Label, Textarea } from "@recall/ui-web";
import { useLearningActivities } from "../../../hooks/use-learning-activities";

type LearningActivitiesPanelModel = ReturnType<typeof useLearningActivities>;

type LearningActivitiesPanelAttemptProps = {
  readonly model: LearningActivitiesPanelModel;
  readonly locked: boolean;
  readonly customInteraction: ReactNode;
  readonly acceptsSelfAssessment: boolean;
  readonly canHostAssessment: boolean;
  readonly hasServices: boolean;
  readonly leaving: boolean;
  readonly onLeavingChange: Dispatch<SetStateAction<boolean>>;
};

export function LearningActivitiesPanelAttempt({
  model,
  locked,
  customInteraction,
  acceptsSelfAssessment,
  canHostAssessment,
  hasServices,
  leaving,
  onLeavingChange,
}: LearningActivitiesPanelAttemptProps) {
  const activity = model.activity;
  const presentation = model.presentation;
  if (!activity || !presentation) return null;
  const selectSelfAssessment = (score: number) => {
    model.setResponse((current) => ({ ...current, selfScore: score }));
  };
  const selfAssessment = acceptsSelfAssessment ? (
    <SelfAssessment
      selectedScore={model.response.selfScore}
      disabled={locked}
      onSelect={selectSelfAssessment}
    />
  ) : null;
  const referenceControl = presentation.reference ? (
    <ActivityReference
      reference={presentation.reference}
      shown={model.referenceShown}
      disabled={locked}
      onReveal={model.reveal}
    />
  ) : null;
  const followUpButton =
    activity.pluginId === "recall.interrogation" && presentation.prompts.length < 10 ? (
      <Button
        variant="secondary"
        disabled={locked || model.response.answers.some((answer) => !answer.trim())}
        onClick={model.followUp}
      >
        Suggest AI follow-up
      </Button>
    ) : null;
  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <h3 className="font-semibold">{activity.title}</h3>
      {presentation.code && (
        <p className="text-sm text-muted-foreground">
          Write a JavaScript solve function. Run it in the isolated test runner, or assess it
          against the rubric.
        </p>
      )}
      {activity.pluginId === "recall.interrogation" && (
        <p className="text-sm text-muted-foreground">
          Answer the staged questions, then optionally request an AI follow-up or assessment. AI
          suggestions require your approval.
        </p>
      )}
      {customInteraction}
      {!customInteraction &&
        presentation.prompts.map((prompt, index) =>
          index <= model.stage ? (
            <ActivityPromptAnswer
              key={index}
              prompt={prompt}
              index={index}
              code={presentation.code}
              answer={model.response.answers[index] ?? ""}
              disabled={locked || !!model.result}
              showAnswer={presentation.options.length === 0}
              onAnswer={(answer) => {
                model.answer(index, answer);
              }}
            />
          ) : null,
        )}
      {!customInteraction &&
        presentation.options.map((option) => (
          <Label key={option.id} className="flex items-center gap-3">
            <Checkbox
              checked={model.response.selectedOptionIds.includes(option.id)}
              disabled={locked || !!model.result}
              onCheckedChange={() => {
                model.choose(option.id);
              }}
            />
            {option.text}
          </Label>
        ))}
      <p className="whitespace-pre-wrap text-sm">Rubric: {presentation.rubric}</p>
      {model.stage < presentation.prompts.length - 1 ? (
        <Button
          disabled={locked || !model.response.answers[model.stage]?.trim()}
          onClick={() => {
            model.setStage((current) => current + 1);
          }}
        >
          Next question
        </Button>
      ) : (
        !model.result && (
          <>
            {presentation.options.length === 0 && (
              <>
                {selfAssessment}
                {referenceControl}
              </>
            )}
            <Button disabled={locked} onClick={model.assess}>
              {presentation.options.length ||
              model.activePlugin?.capabilities.assessment === "deterministic"
                ? "Check answer"
                : "Review assessment"}
            </Button>
          </>
        )
      )}
      {!model.result &&
        hasServices &&
        canHostAssessment &&
        presentation.options.length === 0 &&
        model.stage === presentation.prompts.length - 1 && (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={locked || model.response.answers.some((answer) => !answer.trim())}
              onClick={model.hostedAssess}
            >
              {presentation.code ? "Run tests" : "Request AI assessment"}
            </Button>
            {followUpButton}
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
      <Button
        variant="secondary"
        disabled={locked}
        onClick={() => {
          onLeavingChange(true);
        }}
      >
        Leave attempt
      </Button>
      <AlertDialog open={leaving} onOpenChange={onLeavingChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this attempt?</AlertDialogTitle>
            <AlertDialogDescription>
              Latest unsaved changes will be discarded. Previously saved progress remains available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue</AlertDialogCancel>
            <AlertDialogAction onClick={model.leave}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ActivityPromptAnswer({
  prompt,
  index,
  code,
  answer,
  disabled,
  showAnswer,
  onAnswer,
}: {
  readonly prompt: string;
  readonly index: number;
  readonly code: boolean;
  readonly answer: string;
  readonly disabled: boolean;
  readonly showAnswer: boolean;
  readonly onAnswer: (answer: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="whitespace-pre-wrap">{prompt}</p>
      {showAnswer && (
        <>
          <Label htmlFor={`activity-answer-${String(index)}`}>Your response {index + 1}</Label>
          <Textarea
            id={`activity-answer-${String(index)}`}
            className={code ? "min-h-40 font-mono" : "min-h-24"}
            value={answer}
            disabled={disabled}
            maxLength={40_000}
            onChange={(event) => {
              onAnswer(event.target.value);
            }}
          />
        </>
      )}
    </div>
  );
}

function SelfAssessment({
  selectedScore,
  disabled,
  onSelect,
}: {
  readonly selectedScore: number | undefined;
  readonly disabled: boolean;
  readonly onSelect: (score: number) => void;
}) {
  const scores = [
    { value: 0, label: "Needs work" },
    { value: 0.5, label: "Partially meets rubric" },
    { value: 1, label: "Meets rubric" },
  ];
  return (
    <div className="grid gap-2">
      <Label>How does your response meet the rubric?</Label>
      <div className="flex flex-wrap gap-2">
        {scores.map((score) => (
          <Button
            key={score.value}
            variant="secondary"
            aria-pressed={selectedScore === score.value}
            disabled={disabled}
            onClick={() => {
              onSelect(score.value);
            }}
          >
            {score.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ActivityReference({
  reference,
  shown,
  disabled,
  onReveal,
}: {
  readonly reference: string;
  readonly shown: boolean;
  readonly disabled: boolean;
  readonly onReveal: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Button variant="secondary" disabled={disabled} onClick={onReveal}>
        Reveal reference (marks assistance)
      </Button>
      {shown && <pre className="whitespace-pre-wrap text-sm">{reference}</pre>}
    </div>
  );
}
