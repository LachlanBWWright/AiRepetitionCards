import { Button } from "@recall/ui-web";
import type { useLearningActivities } from "../../../hooks/use-learning-activities";

type Attempt = ReturnType<typeof useLearningActivities>["library"]["attempts"][number];

export function ActivityAttemptHistory({
  attempts,
  historyLimit,
  onShowMore,
}: {
  readonly attempts: readonly Attempt[];
  readonly historyLimit: number;
  readonly onShowMore: () => void;
}) {
  if (attempts.length === 0) return null;
  return (
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
            <AttemptHistoryEntry key={attempt.id} attempt={attempt} />
          ))}
        {attempts.length > historyLimit && (
          <Button variant="secondary" onClick={onShowMore}>
            Show more attempts
          </Button>
        )}
      </div>
    </details>
  );
}

function AttemptHistoryEntry({ attempt }: { readonly attempt: Attempt }) {
  return (
    <article className="grid gap-2 rounded-lg border p-3">
      <h3 className="font-semibold">
        {attempt.activity.title} · {new Date(attempt.acceptedAt).toLocaleString()}
      </h3>
      {attempt.response.answers.map((answer, index) => (
        <AttemptAnswer
          key={index}
          prompt={attempt.response.presentedPrompts?.[index] ?? attempt.activity.fallback}
          answer={answer}
        />
      ))}
      {attempt.response.selectedOptionIds.length > 0 && (
        <p className="text-sm">Selected choices: {attempt.response.selectedOptionIds.join(", ")}</p>
      )}
      <p className="text-sm">{attempt.result.feedback}</p>
      <p className="text-sm text-muted-foreground">
        {attempt.response.assistance === "none" ? "Unaided" : "Assisted"} · Original activity
        revision {attempt.activity.revision}
      </p>
    </article>
  );
}

function AttemptAnswer({ prompt, answer }: { readonly prompt: string; readonly answer: string }) {
  return (
    <div>
      <p className="text-sm font-medium">{prompt}</p>
      <pre className="whitespace-pre-wrap text-sm">{answer}</pre>
    </div>
  );
}
