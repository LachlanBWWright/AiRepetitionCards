import { Button, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import type { TutorContext } from "@recall/ai-core";
type Props = {
  readonly history: TutorContext["history"];
  readonly hasQuiz: boolean;
  readonly areaTitle: string;
  readonly busy: boolean;
  readonly contextValid: boolean;
  readonly answer: string;
  readonly showAnswerInput: boolean;
  readonly onAnswerChange: (value: string) => void;
  readonly onAskQuestion: () => void;
  readonly onCheckAnswer: (answer: string) => void;
};
export function TutorQuestion({
  history,
  hasQuiz,
  areaTitle,
  busy,
  contextValid,
  answer,
  showAnswerInput,
  onAnswerChange,
  onAskQuestion,
  onCheckAnswer,
}: Props) {
  return (
    <>
      {" "}
      <div className="space-y-4">
        {history.length === 0 && !hasQuiz && (
          <div className="space-y-2">
            <h2 className="text-lg font-semibold" id="tutor-panel-title">
              Test your understanding
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Answer a question from {areaTitle} and get feedback from your tutor.
            </p>
          </div>
        )}
        <Button
          variant={history.length === 0 ? "primary" : "outline"}
          type="button"
          disabled={busy}
          onClick={() => {
            onAskQuestion();
          }}
        >
          {busy
            ? "Preparing question…"
            : history.length === 0
              ? "Ask a question"
              : "Ask another question"}
        </Button>
      </div>
      {!contextValid && (
        <Alert variant="destructive">
          <AlertDescription>
            Context is too long. Shorten objective descriptions or AI instructions.
          </AlertDescription>
        </Alert>
      )}
      {history.at(-1) && (
        <p
          className={`mt-3 rounded-lg p-3 text-sm leading-relaxed ${history.at(-1)?.role === "learner" ? "bg-primary/10" : "bg-muted/40"}`}
        >
          <strong className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {history.at(-1)?.role === "assistant" ? "Tutor" : "You"}
          </strong>
          {history.at(-1)?.content}
        </p>
      )}
      {showAnswerInput && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!answer.trim()) return;
            onCheckAnswer(answer.trim());
          }}
        >
          <Label className="sr-only" htmlFor="tutor-answer">
            Your answer
          </Label>
          <Textarea
            id="tutor-answer"
            value={answer}
            onChange={(event) => {
              onAnswerChange(event.target.value);
            }}
            placeholder="Write your answer…"
            maxLength={8000}
            required
          />
          <Button variant="secondary" size="small" type="submit" disabled={!answer.trim()}>
            Check answer
          </Button>
        </form>
      )}
    </>
  );
}
