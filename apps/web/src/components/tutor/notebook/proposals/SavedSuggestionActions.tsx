import { Button } from "@recall/ui-web";
import type { KnowledgeNotebookModel } from "../useKnowledgeNotebookModel";

type Proposal = NonNullable<KnowledgeNotebookModel["notebook"]>["proposals"][number];
type Props = {
  readonly accepted: readonly Proposal[];
  readonly proposals: readonly Proposal[];
  readonly busy: boolean;
  readonly onResolve: KnowledgeNotebookModel["resolve"];
  readonly onStartReview: KnowledgeNotebookModel["onStartReview"];
};
export function SavedSuggestionActions({
  accepted,
  proposals,
  busy,
  onResolve,
  onStartReview,
}: Props) {
  return (
    <>
      {accepted.length > 0 && (
        <>
          <p>{accepted.length} cards saved to your library.</p>
          {accepted
            .filter((entry) => !entry.providerAcknowledged)
            .map((entry) => (
              <RetryConfirmation
                key={entry.id}
                entry={entry}
                status="accepted"
                busy={busy}
                onResolve={onResolve}
              />
            ))}
          {onStartReview && (
            <Button type="button" variant="primary" onClick={onStartReview}>
              Study saved cards
            </Button>
          )}
        </>
      )}
      {proposals
        .filter((entry) => entry.status === "discarded" && !entry.providerAcknowledged)
        .map((entry) => (
          <RetryConfirmation
            key={entry.id}
            entry={entry}
            status="discarded"
            busy={busy}
            onResolve={onResolve}
          />
        ))}
    </>
  );
}
function RetryConfirmation({
  entry,
  status,
  busy,
  onResolve,
}: {
  readonly entry: Proposal;
  readonly status: "accepted" | "discarded";
  readonly busy: boolean;
  readonly onResolve: KnowledgeNotebookModel["resolve"];
}) {
  return (
    <Button
      variant="secondary"
      size="small"
      type="button"
      disabled={busy}
      onClick={() => {
        onResolve(entry, status);
      }}
    >
      {status === "accepted" ? "Retry confirmation: " : "Retry discard confirmation: "}
      {entry.proposal.front}
    </Button>
  );
}
