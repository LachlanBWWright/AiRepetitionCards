import type { KnowledgeNotebookModel } from "../useKnowledgeNotebookModel";
type Notebook = NonNullable<KnowledgeNotebookModel["notebook"]>;
type TutorEvidence = Extract<Notebook["evidence"][number], { readonly kind: "tutor" }>;
export function NotebookPracticeFeedback({
  evaluation,
}: {
  readonly evaluation: TutorEvidence["evaluation"];
}) {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
      <h3 className="text-base font-semibold">Latest feedback</h3>
      <p className="whitespace-pre-wrap">{evaluation.feedback}</p>
      {evaluation.misconception && <p>Unresolved misconception: {evaluation.misconception}</p>}
    </div>
  );
}
export function NotebookRecentAnswers({
  evidence,
  concepts,
}: {
  readonly evidence: Notebook["evidence"];
  readonly concepts: Notebook["concepts"];
}) {
  const recent = evidence
    .filter((entry) => entry.kind === "tutor")
    .slice(-3)
    .reverse();
  if (recent.length === 0) return null;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold leading-6">Recent answers</h3>
      <div className="space-y-4 pt-3">
        {recent.map((entry) => (
          <RecentAnswer
            key={entry.id}
            entry={entry}
            conceptTitle={concepts.find((concept) => concept.id === entry.conceptId)?.title}
          />
        ))}
      </div>
    </section>
  );
}
function RecentAnswer({
  entry,
  conceptTitle,
}: {
  readonly entry: TutorEvidence;
  readonly conceptTitle: string | undefined;
}) {
  return (
    <article
      tabIndex={-1}
      data-search-target={`conversation:${entry.id}`}
      className="border-b py-3"
    >
      <strong>{conceptTitle}</strong>
      <>
        <p>{entry.question}</p>
        <p className="whitespace-pre-wrap">Your answer: {entry.answer || "No answer"}</p>
        <p>{entry.evaluation.feedback}</p>
      </>
    </article>
  );
}
