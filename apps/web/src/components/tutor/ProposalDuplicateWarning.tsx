"use client";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import type { CardDuplicateMatch } from "@recall/application";
import { Label } from "@recall/ui-web/components/label";
import { Checkbox } from "@recall/ui-web/components/checkbox";

export function ProposalDuplicateWarning({
  matches,
  acknowledged,
  disabled,
  onChange,
}: {
  readonly matches: readonly CardDuplicateMatch[];
  readonly acknowledged: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  if (matches.length === 0) return null;
  return (
    <Alert role="status">
      <AlertDescription>
        <p>Possible duplicates</p>
        <ul>
          {matches.map(({ candidate, reason }) => (
            <li key={candidate.id}>
              {candidate.front}
              {candidate.areaTitle ? ` · ${candidate.areaTitle}` : ""}
              <p>{reason}</p>
            </li>
          ))}
        </ul>
      </AlertDescription>
      <Label>
        <Checkbox
          checked={acknowledged}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked === true)}
        />{" "}
        Keep both
      </Label>
    </Alert>
  );
}
