"use client";

import type { CardProposal } from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import { Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";

import type { ReactNode } from "react";
type Props = {
  readonly proposal: CardProposal;
  readonly objectives: KnowledgeArea["objectives"];
  readonly disabled: boolean;
  readonly onChange: (proposal: CardProposal) => void;
  readonly assistance: ReactNode;
  readonly duplicateReview: ReactNode;
  readonly actions: ReactNode;
};
export function TutorProposalEditor({
  proposal,
  objectives,
  disabled,
  onChange,
  assistance,
  duplicateReview,
  actions,
}: Props) {
  return (
    <div className="mt-3 grid gap-2 rounded-lg border bg-muted/30 p-4">
      <h3 className="text-base font-semibold">Suggested card</h3>
      <Label htmlFor="tutor-proposal-front">Question</Label>
      <Textarea
        id="tutor-proposal-front"
        value={proposal.front}
        maxLength={1000}
        disabled={disabled}
        onChange={(event) => {
          onChange({ ...proposal, front: event.target.value });
        }}
      />
      <Label htmlFor="tutor-proposal-back">Answer</Label>
      <Textarea
        id="tutor-proposal-back"
        value={proposal.back}
        maxLength={3000}
        disabled={disabled}
        onChange={(event) => {
          onChange({ ...proposal, back: event.target.value });
        }}
      />
      <Label htmlFor="tutor-proposal-objective">Learning objective</Label>
      <Select
        value={proposal.objectiveId ?? "__recall_none__"}
        disabled={disabled}
        onValueChange={(value) => {
          onChange({
            ...proposal,
            objectiveId: value === "__recall_none__" ? null : value,
          });
        }}
      >
        <SelectTrigger id="tutor-proposal-objective" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__recall_none__">No objective</SelectItem>
          {proposal.objectiveId &&
            !objectives.some((objective) => objective.id === proposal.objectiveId) && (
              <SelectItem value={proposal.objectiveId}>
                Unavailable objective: choose another
              </SelectItem>
            )}
          {objectives.map((objective) => (
            <SelectItem key={objective.id} value={objective.id}>
              {objective.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Label htmlFor="tutor-proposal-rationale">Why this card helps</Label>
      <Textarea
        id="tutor-proposal-rationale"
        value={proposal.rationale}
        maxLength={1000}
        disabled={disabled}
        onChange={(event) => {
          onChange({ ...proposal, rationale: event.target.value });
        }}
      />
      {assistance}
      {duplicateReview}
      {actions}
    </div>
  );
}
