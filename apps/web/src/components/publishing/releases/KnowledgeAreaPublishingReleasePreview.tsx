import type { KnowledgeAreaDiff } from "@recall/application";
import { KnowledgeAreaDiffView } from "../updates/KnowledgeAreaDiffView";

type Props = {
  readonly comparison: KnowledgeAreaDiff;
  readonly warnings: readonly string[];
};

export function KnowledgeAreaPublishingReleasePreview({ comparison, warnings }: Props) {
  return (
    <section className="grid gap-2 rounded-lg border bg-muted/30 p-3" aria-label="Release changes">
      <h4 className="text-sm font-semibold">Changes since the previous release</h4>
      <KnowledgeAreaDiffView comparison={comparison} purpose="release" />
      {warnings.map((warning) => (
        <p className="text-sm text-amber-800" key={warning}>
          {warning}
        </p>
      ))}
    </section>
  );
}
