import type { CardVersion, LearningArea, Workspace } from "@recall/domain";
import { Button } from "@recall/ui-web";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import { KnowledgeAreaCardLibraryDeletedCardRow } from "./KnowledgeAreaCardLibraryDeletedCardRow";

type KnowledgeAreaCardLibraryDeletedRecoveryProps = {
  readonly versions: readonly CardVersion[];
  readonly area: LearningArea;
  readonly workspace: Workspace | undefined;
  readonly restoring: boolean;
  readonly onRestoreVersion:
    ((version: CardVersion, expectedBaseline: string | undefined) => Promise<boolean>) | undefined;
  readonly baselineForVersion: (version: CardVersion) => string | undefined;
};

export function KnowledgeAreaCardLibraryDeletedRecovery({
  versions,
  area,
  workspace,
  restoring,
  onRestoreVersion,
  baselineForVersion,
}: KnowledgeAreaCardLibraryDeletedRecoveryProps) {
  if (versions.length === 0) return null;

  return (
    <Collapsible className="py-4">
      <CollapsibleTrigger asChild>
        <Button variant="secondary">Deleted cards ({versions.length})</Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {versions.map((version) => (
          <KnowledgeAreaCardLibraryDeletedCardRow
            key={version.cardId}
            version={version}
            area={area}
            workspace={workspace}
            restoring={restoring}
            onRestoreVersion={onRestoreVersion}
            baselineForVersion={baselineForVersion}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
