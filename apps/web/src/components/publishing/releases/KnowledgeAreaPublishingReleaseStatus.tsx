import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import type { ReactNode } from "react";
import type { DeckQualityIssue } from "@recall/application";
import { DeckQualityPanel } from "@/components/knowledge/overview/DeckQualityPanel";

type Props = {
  readonly preview: ReactNode;
  readonly issues: readonly DeckQualityIssue[];
  readonly qualityStatus: "ok" | "failed" | null;
};

export function KnowledgeAreaPublishingReleaseStatus({ preview, issues, qualityStatus }: Props) {
  return (
    <>
      {preview}
      <DeckQualityPanel issues={issues} />
      {!qualityStatus && (
        <p className="text-sm text-muted-foreground" role="status">
          Checking cards and attached media before publishing…
        </p>
      )}
      {qualityStatus === "failed" && (
        <Alert variant="destructive">
          <AlertDescription>
            Deck quality could not be validated, so publishing is paused.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
