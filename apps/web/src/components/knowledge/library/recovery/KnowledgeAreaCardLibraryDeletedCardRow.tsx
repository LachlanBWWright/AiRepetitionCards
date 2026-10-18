import { cardVersionHistory, cardVersionRestoresAsCopy } from "@recall/application";
import type { CardVersion, LearningArea, Workspace } from "@recall/domain";
import { CardVersionHistory } from "../../history/CardVersionHistory";

type KnowledgeAreaCardLibraryDeletedCardRowProps = {
  readonly version: CardVersion;
  readonly area: LearningArea;
  readonly workspace: Workspace | undefined;
  readonly restoring: boolean;
  readonly onRestoreVersion:
    ((version: CardVersion, expectedBaseline: string | undefined) => Promise<boolean>) | undefined;
  readonly baselineForVersion: (version: CardVersion) => string | undefined;
};

export function KnowledgeAreaCardLibraryDeletedCardRow({
  version,
  area,
  workspace,
  restoring,
  onRestoreVersion,
  baselineForVersion,
}: KnowledgeAreaCardLibraryDeletedCardRowProps) {
  return (
    <div>
      <h3 className="text-base font-semibold">{version.card.front}</h3>
      <CardVersionHistory
        versions={workspace ? cardVersionHistory(workspace, area.id, version.cardId) : []}
        {...(onRestoreVersion ? { onRestore: onRestoreVersion } : {})}
        baselineForVersion={baselineForVersion}
        restoresAsCopy={
          workspace ? cardVersionRestoresAsCopy(workspace, version.areaId, version.cardId) : false
        }
        disabled={restoring}
      />
    </div>
  );
}
