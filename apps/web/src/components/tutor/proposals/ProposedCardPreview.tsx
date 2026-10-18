import { useId, useState, type ReactNode } from "react";
import { Button, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@recall/ui-web/components/dialog";
import { ProposalObjectiveSelect } from "./ProposalObjectiveSelect";
import type { CardProposal } from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
export function ProposedCardPreview({
  proposal,
  objectives,
  disabled,
  acceptDisabled,
  onChange,
  onAccept,
  onDiscard,
  children,
  editorTools,
}: {
  readonly proposal: CardProposal;
  readonly objectives: KnowledgeArea["objectives"];
  readonly disabled: boolean;
  readonly acceptDisabled: boolean;
  readonly onChange: (proposal: CardProposal) => void;
  readonly onAccept: () => void;
  readonly onDiscard: () => void;
  readonly children?: ReactNode;
  readonly editorTools?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const id = useId();
  return (
    <article className="overflow-hidden rounded-xl border bg-card" aria-label="Proposed card">
      <div className="space-y-3 p-4 sm:p-5">
        <p className="text-xs font-medium text-muted-foreground">Suggested card</p>
        <p className="whitespace-pre-wrap text-base font-medium leading-6 [overflow-wrap:anywhere]">
          {proposal.front}
        </p>
        <div className="border-t pt-3 text-sm leading-6 text-muted-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
          {proposal.back}
        </div>
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-5">
        <Button size="small" disabled={acceptDisabled} onClick={onAccept}>
          Add card
        </Button>
        <Button
          size="small"
          variant="secondary"
          disabled={disabled}
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <Button
          size="small"
          variant="link"
          className="ml-auto text-muted-foreground"
          disabled={disabled}
          onClick={onDiscard}
        >
          Discard
        </Button>
      </div>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="gap-4 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit proposed card</DialogTitle>
            <DialogDescription className="sr-only">
              Edit the question and answer before adding this card.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-front`}>Question</Label>
            <Textarea
              id={`${id}-front`}
              rows={3}
              className="min-h-24 resize-y text-sm leading-6"
              disabled={disabled}
              maxLength={1000}
              value={proposal.front}
              onChange={(event) => onChange({ ...proposal, front: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-back`}>Answer</Label>
            <Textarea
              id={`${id}-back`}
              rows={5}
              className="min-h-32 resize-y text-sm leading-6"
              disabled={disabled}
              maxLength={3000}
              value={proposal.back}
              onChange={(event) => onChange({ ...proposal, back: event.target.value })}
            />
          </div>
          <ProposalObjectiveSelect
            objectives={objectives}
            value={proposal.objectiveId}
            disabled={disabled}
            onChange={(objectiveId) => onChange({ ...proposal, objectiveId })}
          />
          {editorTools}
          <Button className="justify-self-end" size="small" onClick={() => setEditing(false)}>
            Done
          </Button>
        </DialogContent>
      </Dialog>
    </article>
  );
}
