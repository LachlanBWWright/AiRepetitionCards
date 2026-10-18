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
      <div className="grid gap-5 rounded-xl border bg-card p-4 sm:p-6">
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
          <Button type="button" variant="primary" disabled={questionDisabled} onClick={ask}>
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
    <TabsContent value="practice" forceMount className="space-y-6 data-[state=inactive]:hidden">
      <div className="grid gap-4">
        <form
          className="max-w-3xl space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (notebook) saveGoal();
            else begin();
          }}
        >
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
      </div>
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
    <div className="flex flex-wrap items-center gap-3">
      {!active && (
        <Button
          className="w-full sm:w-fit sm:min-w-36"
          type="button"
          variant="primary"
          disabled={disabled}
          onClick={onBegin}
        >
          {hasNotebook ? "Start investigation" : "Start investigation"}
        </Button>
      )}
      {goalChanged && (
        <>
          <Button
            type="submit"
            variant={active ? "primary" : "outline"}
            size="small"
            disabled={disabled}
          >
            Save goal
          </Button>
          <Button type="button" variant="link" size="small" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
