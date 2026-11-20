import { NotebookPracticeControls } from "./NotebookPracticeControls";
import { NotebookPracticeFeedback, NotebookRecentAnswers } from "./NotebookPracticeHistory";
import { NotebookPracticeQuestion } from "./NotebookPracticeQuestion";
import { Button, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import { TabsContent } from "@recall/ui-web/components/tabs";
import type { KnowledgeNotebookModel } from "../useKnowledgeNotebookModel";
export function KnowledgeNotebookPractice({ model }: { readonly model: KnowledgeNotebookModel }) {
  const {
    notebook,
    saveGoal,
    begin,
    goalId,
    goal,
    busy,
    loaded,
    unsaved,
    setGoal,
    goalChanged,
    goalHelpId,
    active,
    pendingQuestion,
    answer,
    setAnswer,
    confidence,
    setConfidence,
    networkDisabled,
    submitAnswer,
    saveAnswerDraft,
    questionDisabled,
    ask,
    control,
    lastEvidence,
  } = model;
  function renderActiveQuestion() {
    return (
      <div className="grid gap-0 rounded-xl border bg-card p-4 sm:p-6">
        {pendingQuestion ? (
          <NotebookPracticeQuestion
            question={pendingQuestion}
            draft={{ answer, confidence }}
            onAnswerChange={setAnswer}
            onConfidenceChange={setConfidence}
            onSubmit={submitAnswer}
            onSaveDraft={() => {
              saveAnswerDraft(answer);
            }}
            networkDisabled={networkDisabled}
            draftDisabled={busy || unsaved}
          />
        ) : (
          <Button type="button" variant="default" disabled={questionDisabled} onClick={ask}>
            Ask a question
          </Button>
        )}
        <NotebookPracticeControls
          disabled={busy || unsaved}
          questionDisabled={questionDisabled}
          onControl={control}
        />
      </div>
    );
  }
  return (
    <TabsContent
      value="practice"
      forceMount
      className="flex flex-col gap-6 data-[state=inactive]:hidden"
    >
      <form
        className="flex max-w-3xl flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (notebook) saveGoal();
          else begin();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={goalId}>Session objective</Label>
          <Textarea
            id={goalId}
            value={goal}
            disabled={busy || !loaded || unsaved}
            maxLength={2000}
            required
            rows={2}
            onChange={(event) => {
              setGoal(event.target.value);
            }}
            placeholder="What do you want to understand? For example, how cells turn food into energy."
            aria-describedby={goalChanged ? goalHelpId : undefined}
          />
        </div>
        {(!active || goalChanged) && (
          <GoalActions
            active={active}
            goalChanged={goalChanged}
            hasNotebook={Boolean(notebook)}
            disabled={busy || !loaded || unsaved || !goal.trim()}
            busy={busy}
            onBegin={begin}
            onCancel={() => {
              if (notebook) setGoal(notebook.goal);
            }}
          />
        )}
        {goalChanged && (
          <p id={goalHelpId} className="text-sm leading-6 text-muted-foreground">
            {practiceGoalHelp(Boolean(pendingQuestion), active)}
          </p>
        )}
      </form>
      {notebook && (
        <>
          <div className="space-y-5">
            {active && renderActiveQuestion()}
            {lastEvidence?.kind === "tutor" && (
              <NotebookPracticeFeedback evaluation={lastEvidence.evaluation} />
            )}
            <NotebookRecentAnswers evidence={notebook.evidence} concepts={notebook.concepts} />
          </div>
        </>
      )}
    </TabsContent>
  );
}

function practiceGoalHelp(pendingQuestion: boolean, active: boolean): string {
  if (pendingQuestion)
    return "Applies to future questions. Your current question and answer will stay.";
  return active
    ? "Save your goal to use it for your next question."
    : "Save your goal or start practice to use it for your next question.";
}
function GoalActions({
  active,
  goalChanged,
  hasNotebook,
  disabled,
  busy,
  onBegin,
  onCancel,
}: {
  readonly active: boolean;
  readonly goalChanged: boolean;
  readonly hasNotebook: boolean;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onBegin: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {!active && (
        <Button
          className="w-full sm:w-fit sm:min-w-36"
          type="button"
          variant="default"
          disabled={disabled}
          onClick={onBegin}
        >
          {hasNotebook ? "Start investigation" : "Start investigation"}
        </Button>
      )}
      {goalChanged && (
        <>
          <Button type="submit" variant="default" size="default" disabled={disabled}>
            Save goal
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="default"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
