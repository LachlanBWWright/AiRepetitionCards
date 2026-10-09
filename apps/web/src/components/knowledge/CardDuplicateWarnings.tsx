"use client";

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
import { Button } from "../ui/Button";

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
    <section
      aria-labelledby={`${fieldId}-title`}
      className="my-4"
    >
      <h3 className="text-lg font-semibold" id={`${fieldId}-title`}>Check existing cards</h3>
      <ul className="my-6 list-none space-y-0 p-0">
        {matches.map((match) => (
          <li key={match.candidate.id} className="border-b py-4 last:border-b-0">
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {match.candidate.front}
            </p>
            <p>
              <Badge variant="secondary">{match.reason}</Badge>
              {match.candidate.areaTitle ? ` · ${match.candidate.areaTitle}` : ""}
            </p>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button size="small" variant="secondary">
                  Compare answer
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="whitespace-pre-wrap">{match.candidate.back}</p>
              </CollapsibleContent>
            </Collapsible>
            {onOpenCandidate && (
              <Button
                size="small"
                variant="secondary"
                disabled={disabled}
                onClick={() => onOpenCandidate(match.candidate)}
              >
                Open existing card
              </Button>
            )}
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2" htmlFor={`${fieldId}-keep`}>
        <Checkbox
          id={`${fieldId}-keep`}
          checked={keepBoth}
          disabled={disabled}
          onCheckedChange={(checked) => onKeepBothChange(checked === true)}
        />
        Keep both cards
      </label>
    </section>
  );
}
