import { cardVersionHistory } from "@recall/application";
import type { CardVersion, LearningArea, Assessment, Workspace } from "@recall/domain";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import { ChevronDown } from "lucide-react";
import { CardVersionHistory } from "../../history/CardVersionHistory";

type KnowledgeAreaCardLibraryQuestionProps = {
  readonly area: LearningArea;
  readonly card: Assessment;
  readonly flagged: boolean;
  readonly workspace: Workspace | undefined;
  readonly onRestoreVersion:
    ((version: CardVersion, expectedBaseline: string | undefined) => Promise<boolean>) | undefined;
  readonly baselineForVersion: (version: CardVersion) => string | undefined;
  readonly restoring: boolean;
};

export function KnowledgeAreaCardLibraryQuestion({
  area,
  card,
  flagged,
  workspace,
  onRestoreVersion,
  baselineForVersion,
  restoring,
}: KnowledgeAreaCardLibraryQuestionProps) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-start justify-between gap-3 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          <span className="[overflow-wrap:anywhere]" style={{ whiteSpace: "pre-wrap" }}>
            {card.front}
            {flagged && (
              <span className="ml-2 text-xs text-muted-foreground">Flagged for editing</span>
            )}
          </span>
          <ChevronDown
            className="mt-0.5 size-4 shrink-0 text-[var(--muted)] transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2 pt-3 font-normal text-[var(--muted)]">
        <p className="m-0" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          <span className="font-medium text-[var(--ink)]">Answer: </span>
          {card.back}
        </p>
        <p className="m-0">
          <span className="font-medium text-[var(--ink)]">Objective: </span>
          {card.objective}
        </p>
        <p className="m-0">
          <span className="font-medium text-[var(--ink)]">Next review: </span>
          <time dateTime={card.schedule.due}>{card.schedule.due.slice(0, 10)}</time>
        </p>
        {(card.tags ?? []).length > 0 && (
          <p className="m-0" aria-label="Tags">
            <span className="font-medium text-[var(--ink)]">Tags: </span>
            {card.tags?.join(", ")}
          </p>
        )}
        {workspace && (
          <CardVersionHistory
            versions={cardVersionHistory(workspace, area.id, card.id)}
            currentCard={card}
            {...(onRestoreVersion ? { onRestore: onRestoreVersion } : {})}
            baselineForVersion={baselineForVersion}
            disabled={restoring}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
