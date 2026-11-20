"use client";

import { FieldLabel } from "@recall/ui-web";

import {
  findCardDuplicates,
  type CardDuplicateCandidate,
  type CardDuplicateContent,
} from "@recall/application";
import { useId } from "react";
import { Badge } from "@recall/ui-web/components/badge";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import { Button } from "../../../ui/Button";

export type CardDuplicateWarningsProps = {
  readonly draft: CardDuplicateContent;
  readonly candidates: readonly CardDuplicateCandidate[];
  readonly excludeCardId?: string;
  readonly keepBoth: boolean;
  readonly onKeepBothChange: (value: boolean) => void;
  readonly onOpenCandidate?: (candidate: CardDuplicateCandidate) => void;
  readonly disabled?: boolean;
};

export function cardDuplicateAcknowledgementKey(
  draft: CardDuplicateContent,
  candidates: readonly CardDuplicateCandidate[],
  excludeCardId?: string,
): string {
  return JSON.stringify([
    draft.front,
    draft.back,
    draft.cloze ?? null,
    excludeCardId ?? null,
    findCardDuplicates(draft, candidates, {
      ...(excludeCardId ? { excludeCardId } : {}),
      limit: 5,
    }).map(({ candidate }) => [
      candidate.id,
      candidate.front,
      candidate.back,
      candidate.cloze ?? null,
    ]),
  ]);
}

export function CardDuplicateWarnings({
  draft,
  candidates,
  excludeCardId,
  keepBoth,
  onKeepBothChange,
  onOpenCandidate,
  disabled = false,
}: CardDuplicateWarningsProps) {
  const fieldId = useId();
  const matches = findCardDuplicates(draft, candidates, {
    ...(excludeCardId ? { excludeCardId } : {}),
    limit: 5,
  });
  if (matches.length === 0) return null;
  return (
    <section aria-labelledby={`${fieldId}-title`} className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold" id={`${fieldId}-title`}>
        Check existing cards
      </h3>
      <ul className="flex min-w-0 list-none flex-col gap-4 p-0">
        {matches.map((match) => (
          <li key={match.candidate.id} className="min-w-0 border-b py-4 last:border-b-0">
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{match.candidate.front}</p>
            <p className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2 [overflow-wrap:anywhere]">
              <Badge
                variant="secondary"
                className="max-w-full whitespace-normal [overflow-wrap:anywhere]"
              >
                {match.reason}
              </Badge>
              {match.candidate.areaTitle ? ` · ${match.candidate.areaTitle}` : ""}
            </p>
            <DuplicateAnswer answer={match.candidate.back} />
            {onOpenCandidate && (
              <OpenCandidateButton
                candidate={match.candidate}
                disabled={disabled}
                onOpen={onOpenCandidate}
              />
            )}
          </li>
        ))}
      </ul>
      <FieldLabel className="flex items-center gap-2" htmlFor={`${fieldId}-keep`}>
        <Checkbox
          id={`${fieldId}-keep`}
          checked={keepBoth}
          disabled={disabled}
          onCheckedChange={(checked) => {
            onKeepBothChange(checked === true);
          }}
        />
        Keep both cards
      </FieldLabel>
    </section>
  );
}

function DuplicateAnswer({ answer }: { readonly answer: string }) {
  return (
    <Collapsible>
      <CollapsibleTrigger>Compare answer</CollapsibleTrigger>
      <CollapsibleContent>
        <p className="whitespace-pre-wrap">{answer}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function OpenCandidateButton({
  candidate,
  disabled,
  onOpen,
}: {
  readonly candidate: CardDuplicateCandidate;
  readonly disabled: boolean;
  readonly onOpen: (candidate: CardDuplicateCandidate) => void;
}) {
  return (
    <Button
      size="default"
      variant="default"
      disabled={disabled}
      onClick={() => {
        onOpen(candidate);
      }}
    >
      Open existing card
    </Button>
  );
}
