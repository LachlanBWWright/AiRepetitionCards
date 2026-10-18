"use client";

import { Input } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import type { DeckSharingMetadata } from "./DeckSharingPanelDetail";

type DeckSharingPanelMetadataFieldsProps = {
  readonly metadata: DeckSharingMetadata;
  readonly onChange: (field: "language" | "authorName", value: string) => void;
};

export function DeckSharingPanelMetadataFields({
  metadata,
  onChange,
}: DeckSharingPanelMetadataFieldsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Label className="grid gap-2">
        Language
        <Input
          aria-label="Deck language"
          value={metadata.language}
          onChange={(event) => {
            onChange("language", event.target.value);
          }}
        />
      </Label>
      <Label className="grid gap-2">
        Author
        <Input
          aria-label="Author name"
          value={metadata.authorName}
          onChange={(event) => {
            onChange("authorName", event.target.value);
          }}
        />
      </Label>
    </div>
  );
}
