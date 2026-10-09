"use client";

import {
  cardVersionHistory,
  cardVersionRestoresAsCopy,
  workspaceAuthoringBaseline,
} from "@recall/application";
import type { CardVersion, Workspace } from "@recall/domain";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import { CardVersionHistory } from "./CardVersionHistory";

export type DeletedCardRecoveryProps = {
  readonly workspace: Workspace;
  readonly onRestoreVersion: (
    version: CardVersion,
    expectedBaseline: string | undefined,
  ) => Promise<boolean>;
  readonly disabled?: boolean;
};

export function DeletedCardRecovery({
  workspace,
  onRestoreVersion,
  disabled = false,
}: DeletedCardRecoveryProps) {
  const versions = cardVersionHistory(workspace);
  const deleted = versions.filter(
    (version, index) =>
      !workspace.areas.some(
        (area) =>
          area.id === version.areaId && area.cards.some((card) => card.id === version.cardId),
      ) &&
      versions.findIndex(
        (item) => item.areaId === version.areaId && item.cardId === version.cardId,
      ) === index,
  );
  if (deleted.length === 0) return null;
  return (
    <Accordion type="single" collapsible className="py-4">
      <AccordionItem value="deleted-cards">
        <AccordionTrigger>Deleted cards ({deleted.length})</AccordionTrigger>
        <AccordionContent>
          {deleted.map((version) => (
            <div
              key={`${version.areaId}:${version.cardId}`}
              className="border-b py-4 last:border-b-0"
            >
              <h3 className="text-base font-semibold">{version.card.front}</h3>
              <p>{version.area.title}</p>
              <CardVersionHistory
                versions={cardVersionHistory(workspace, version.areaId, version.cardId)}
                onRestore={onRestoreVersion}
                restoresAsCopy={cardVersionRestoresAsCopy(
                  workspace,
                  version.areaId,
                  version.cardId,
                )}
                baselineForVersion={(entry) =>
                  workspaceAuthoringBaseline(workspace, {
                    kind: "restore-card",
                    areaId: entry.areaId,
                    cardId: entry.cardId,
                    versionId: entry.id,
                  })
                }
                disabled={disabled}
              />
            </div>
          ))}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
