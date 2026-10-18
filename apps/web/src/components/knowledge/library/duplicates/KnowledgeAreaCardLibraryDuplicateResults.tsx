import type { CardDuplicateCandidate } from "@recall/application";
import type { Assessment, LearningArea } from "@recall/domain";
import type { KnowledgeAreaCardLibraryDuplicateScope } from "../KnowledgeAreaCardLibraryDerivations";
import type { getKnowledgeAreaCardLibraryDuplicates } from "../KnowledgeAreaCardLibraryDerivations";
import { KnowledgeAreaCardLibraryDuplicatePair } from "./KnowledgeAreaCardLibraryDuplicatePair";

type DuplicatePair = ReturnType<typeof getKnowledgeAreaCardLibraryDuplicates>[number];

type KnowledgeAreaCardLibraryDuplicateResultsProps = {
  readonly pairs: readonly DuplicatePair[];
  readonly area: LearningArea;
  readonly scope: KnowledgeAreaCardLibraryDuplicateScope;
  readonly scanning: boolean;
  readonly restoring: boolean;
  readonly onEdit: (card: Assessment) => void;
  readonly onOpenDuplicate: ((candidate: CardDuplicateCandidate) => void) | undefined;
};

export function KnowledgeAreaCardLibraryDuplicateResults({
  pairs,
  area,
  scope,
  scanning,
  restoring,
  onEdit,
  onOpenDuplicate,
}: KnowledgeAreaCardLibraryDuplicateResultsProps) {
  if (!scanning) return null;
  if (pairs.length === 0) return <p>No matches in this scan.</p>;

  return (
    <>
      <ul className="my-6 list-none p-0">
        {pairs.map((pair) => (
          <KnowledgeAreaCardLibraryDuplicatePair
            key={`${pair.left.id}:${pair.right.id}`}
            pair={pair}
            area={area}
            scope={scope}
            restoring={restoring}
            onEdit={onEdit}
            onOpenDuplicate={onOpenDuplicate}
          />
        ))}
      </ul>
      {pairs.length >= 100 && <p>Showing the first 100 matches.</p>}
    </>
  );
}
