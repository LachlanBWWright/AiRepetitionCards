import type { Assessment, LearningArea } from "@recall/domain";
import type { CardDuplicateCandidate } from "@recall/application";
import { Button } from "@recall/ui-web";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import type { KnowledgeAreaCardLibraryDuplicateScope } from "../KnowledgeAreaCardLibraryDerivations";
import type { getKnowledgeAreaCardLibraryDuplicates } from "../KnowledgeAreaCardLibraryDerivations";

type DuplicatePair = ReturnType<typeof getKnowledgeAreaCardLibraryDuplicates>[number];

type KnowledgeAreaCardLibraryDuplicatePairProps = {
  readonly pair: DuplicatePair;
  readonly area: LearningArea;
  readonly scope: KnowledgeAreaCardLibraryDuplicateScope;
  readonly restoring: boolean;
  readonly onEdit: (card: Assessment) => void;
  readonly onOpenDuplicate: ((candidate: CardDuplicateCandidate) => void) | undefined;
};

export function KnowledgeAreaCardLibraryDuplicatePair({
  pair: { left, right, reason },
  area,
  scope,
  restoring,
  onEdit,
  onOpenDuplicate,
}: KnowledgeAreaCardLibraryDuplicatePairProps) {
  const openCandidate = (candidate: CardDuplicateCandidate) => {
    const card = area.cards.find((item) => item.id === candidate.id);
    if (card) onEdit(card);
    else onOpenDuplicate?.(candidate);
  };

  return (
    <li className="border-b py-4 last:border-b-0">
      <p>{left.front}</p>
      {scope === "workspace" && <p>{left.areaTitle}</p>}
      <p>{right.front}</p>
      {scope === "workspace" && <p>{right.areaTitle}</p>}
      <p>{reason}</p>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button size="small" variant="secondary">
            Compare answers
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p>{left.back}</p>
          <p>{right.back}</p>
        </CollapsibleContent>
      </Collapsible>
      <Button
        size="small"
        variant="secondary"
        disabled={restoring}
        onClick={() => {
          openCandidate(left);
        }}
      >
        Open first card
      </Button>
      {(onOpenDuplicate || right.areaId === area.id) && (
        <Button
          size="small"
          variant="secondary"
          disabled={restoring}
          onClick={() => {
            openCandidate(right);
          }}
        >
          Open matching card
        </Button>
      )}
    </li>
  );
}
