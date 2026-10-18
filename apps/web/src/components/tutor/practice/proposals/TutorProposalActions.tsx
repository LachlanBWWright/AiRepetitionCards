import { Button } from "@recall/ui-web";
type Props = {
  readonly busy: boolean;
  readonly approvalSaved: boolean;
  readonly hasProposalId: boolean;
  readonly duplicatesAllowed: boolean;
  readonly onApprove: () => void;
  readonly onDiscard: () => void;
};
export function TutorProposalActions({
  busy,
  approvalSaved,
  hasProposalId,
  duplicatesAllowed,
  onApprove,
  onDiscard,
}: Props) {
  return (
    <div>
      <Button
        variant="secondary"
        size="small"
        type="button"
        disabled={busy || !hasProposalId || approvalSaved}
        onClick={onDiscard}
      >
        Discard
      </Button>
      <Button
        variant="secondary"
        size="small"
        type="button"
        disabled={busy || !hasProposalId || !duplicatesAllowed}
        onClick={onApprove}
      >
        {busy ? "Saving…" : approvalSaved ? "Retry approval" : "Approve card"}
      </Button>
    </div>
  );
}
