import type { Assessment, LearningArea } from "@recall/domain";
import type { CardDuplicateCandidate } from "@recall/application";
import { Button } from "@recall/ui-web";
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
    <li className="flex min-w-0 flex-col gap-4 border-b pb-4 last:border-b-0 last:pb-0">
      <section className="flex min-w-0 flex-col gap-2" aria-label="First card">
        <h3 className="text-sm font-semibold">First card</h3>
        <p className="break-words">{left.front}</p>
        <p className="break-words text-muted-foreground">{left.back}</p>
        {scope === "workspace" && <p className="text-sm text-muted-foreground">{left.areaTitle}</p>}
      </section>
      <section className="flex min-w-0 flex-col gap-2" aria-label="Matching card">
        <h3 className="text-sm font-semibold">Matching card</h3>
        <p className="break-words">{right.front}</p>
        <p className="break-words text-muted-foreground">{right.back}</p>
        {scope === "workspace" && (
          <p className="text-sm text-muted-foreground">{right.areaTitle}</p>
        )}
      </section>
      <p className="text-sm text-muted-foreground">{reason}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="default"
          variant="default"
          disabled={restoring}
          onClick={() => {
            openCandidate(left);
          }}
        >
          Open first card
        </Button>
        {(onOpenDuplicate || right.areaId === area.id) && (
          <Button
            size="default"
            variant="default"
            disabled={restoring}
            onClick={() => {
              openCandidate(right);
            }}
          >
            Open matching card
          </Button>
        )}
      </div>
    </li>
  );
}
