import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import { Button } from "@recall/ui-web";
import type { CardInspectionResult, CardProposal, CardRefinementResult } from "@recall/ai-core";
import type { CardDuplicateCandidate } from "@recall/application";
import {
  CardDuplicateWarnings,
  cardDuplicateAcknowledgementKey,
} from "../../knowledge/library/duplicates/CardDuplicateWarnings";

type CardAssistancePanelReviewProps = {
  readonly refinement: CardRefinementResult;
  readonly baseline: CardProposal;
  readonly proposal: CardProposal;
  readonly stale: boolean;
  readonly duplicatesApproved: boolean;
  readonly existingCard: boolean;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly duplicateCandidates: readonly CardDuplicateCandidate[];
  readonly excludeCardId?: string;
  readonly acknowledgedDuplicates: readonly string[];
  readonly refinementCandidates: readonly CardDuplicateCandidate[];
  readonly onKeepBothChange: (key: string, keep: boolean) => void;
  readonly onApply: (mode: "wording" | "replace") => void;
  readonly onDiscard: () => void;
};

export function CardAssistancePanelReview({
  refinement,
  baseline,
  proposal,
  stale,
  duplicatesApproved,
  existingCard,
  disabled,
  busy,
  duplicateCandidates,
  excludeCardId,
  acknowledgedDuplicates,
  refinementCandidates,
  onKeepBothChange,
  onApply,
  onDiscard,
}: CardAssistancePanelReviewProps) {
  return (
    <div className="space-y-3 text-sm leading-6">
      <h4 className="font-medium">Suggested changes</h4>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="small"
            className="group gap-2 px-2 text-xs text-muted-foreground"
          >
            Compare original
            <ChevronDown
              className="size-3 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 border-l-2 pl-3 pt-2 text-muted-foreground">
          <p className="whitespace-pre-wrap">{baseline.front}</p>
          <p className="whitespace-pre-wrap">{baseline.back}</p>
        </CollapsibleContent>
      </Collapsible>
      <div className="space-y-3">
        {refinement.cards.map((card, index) => {
          const candidates = [
            ...duplicateCandidates.filter((candidate) => candidate.id !== excludeCardId),
            ...refinementCandidates.filter(
              (candidate) => candidate.id !== `refinement-${String(index)}`,
            ),
          ];
          const acknowledgementKey = cardDuplicateAcknowledgementKey(card, candidates);
          return (
            <CardAssistancePanelReviewCard
              key={index}
              card={card}
              candidates={candidates}
              keepBoth={acknowledgedDuplicates.includes(acknowledgementKey)}
              onKeepBothChange={createKeepBothChangeHandler(onKeepBothChange, acknowledgementKey)}
              disabled={disabled || busy}
            />
          );
        })}
      </div>
      {existingCard && (
        <p>Replacement cards start fresh schedules. Original review history stays intact.</p>
      )}
      {stale && (
        <Alert variant="destructive">
          <AlertDescription>
            The card changed after this suggestion. Request a new refinement before applying it.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="small"
          variant="default"
          type="button"
          disabled={disabled || busy || stale || !duplicatesApproved}
          onClick={() => {
            onApply("replace");
          }}
        >
          {existingCard ? "Approve replacement cards" : "Apply proposed changes"}
        </Button>
        {existingCard &&
          refinement.cards.length === 1 &&
          refinement.cards[0]?.meaningChanged === false &&
          refinement.cards[0].front.includes("{{c") === proposal.front.includes("{{c") && (
            <Button
              size="small"
              variant="outline"
              type="button"
              disabled={disabled || busy || stale || !duplicatesApproved}
              onClick={() => {
                onApply("wording");
              }}
            >
              Update wording · keep schedule
            </Button>
          )}
        <Button size="small" variant="ghost" type="button" disabled={busy} onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}

function createKeepBothChangeHandler(
  onChange: (key: string, keep: boolean) => void,
  key: string,
): (keep: boolean) => void {
  return (keep) => {
    onChange(key, keep);
  };
}

export function CardAssistancePanelInspection({
  inspection,
}: {
  readonly inspection: CardInspectionResult;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold">AI quality feedback</h4>
      <p>{inspection.summary}</p>
      {inspection.findings.map((finding, index) => (
        <p key={index}>
          {finding.explanation} {finding.suggestion}
        </p>
      ))}
    </div>
  );
}

function CardAssistancePanelReviewCard({
  card,
  candidates,
  keepBoth,
  onKeepBothChange,
  disabled,
}: {
  readonly card: CardRefinementResult["cards"][number];
  readonly candidates: readonly CardDuplicateCandidate[];
  readonly keepBoth: boolean;
  readonly onKeepBothChange: (keep: boolean) => void;
  readonly disabled: boolean;
}) {
  return (
    <article className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm leading-6">
      <p className="whitespace-pre-wrap font-medium">{card.front}</p>
      <p className="whitespace-pre-wrap border-t pt-3">{card.back}</p>
      <CardDuplicateWarnings
        draft={card}
        candidates={candidates}
        keepBoth={keepBoth}
        onKeepBothChange={onKeepBothChange}
        disabled={disabled}
      />
      <CardAssistancePanelReviewRationale
        rationale={card.rationale}
        sourceReferences={card.sourceReferences}
      />
    </article>
  );
}

function CardAssistancePanelReviewRationale({
  rationale,
  sourceReferences,
}: {
  readonly rationale: string;
  readonly sourceReferences: CardRefinementResult["cards"][number]["sourceReferences"];
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="small"
          className="group h-7 gap-2 px-0 text-xs text-muted-foreground"
        >
          Change details
          <ChevronDown
            className="size-3 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2 text-xs leading-5 text-muted-foreground">
        <p>{rationale}</p>
        {sourceReferences.map((reference, referenceIndex) => (
          <blockquote key={referenceIndex}>
            {reference.quote}
            {reference.pageNumber ? ` · page ${String(reference.pageNumber)}` : ""}
          </blockquote>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
