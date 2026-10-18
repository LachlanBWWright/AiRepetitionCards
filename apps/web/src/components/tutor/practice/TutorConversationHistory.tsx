import type { TutorContext } from "@recall/ai-core";

function HistoryEntry({ entry }: { readonly entry: TutorContext["history"][number] }) {
  return (
    <p
      className={`mt-3 rounded-lg p-3 text-sm leading-relaxed ${entry.role === "learner" ? "bg-primary/10" : "bg-muted/40"}`}
    >
      <strong className="mb-1 block text-xs font-semibold text-muted-foreground">
        {entry.role === "assistant" ? "Tutor" : "You"}
      </strong>
      {entry.content}
    </p>
  );
}

export function TutorConversationHistory({
  history,
}: {
  readonly history: TutorContext["history"];
}) {
  return (
    <>
      {" "}
      {history.length > 1 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold leading-6">Recent conversation</h3>
          <div>
            {history.slice(-5, -1).map((entry, index) => (
              <HistoryEntry key={`${String(index)}-${entry.role}`} entry={entry} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
