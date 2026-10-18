import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { Button } from "@recall/ui-web";
import type {
  KnowledgeNotebook,
  StudyCoverageClaim,
  StudyMaterial,
  StudyMaterialCoverage,
} from "@recall/application";
import {
  hasStudyCoveragePlan,
  StudyMaterialSourceSection,
} from "../notebook/materials/StudyMaterialSourceSection";

export type ClaimCoverage = StudyCoverageClaim & {
  readonly planId: string;
  readonly claimId: string;
  readonly materialId: string;
  readonly sectionId: string;
  readonly status: "pending" | "skipped" | "uncovered" | "proposed" | "covered";
  readonly pendingCards: number;
  readonly approvedCards: number;
};

function sectionHasProposals(
  notebook: KnowledgeNotebook,
  materialId: string,
  sectionId: string,
): boolean {
  return notebook.proposals.some((proposal) =>
    proposal.sourceReferences?.some(
      (reference) => reference.materialId === materialId && reference.sectionId === sectionId,
    ),
  );
}

export type StudyMaterialsPanelSourcesProps = {
  readonly notebook: KnowledgeNotebook;
  readonly coverage: readonly StudyMaterialCoverage[];
  readonly claimCoverage: readonly ClaimCoverage[];
  readonly disabled: boolean;
  readonly networkDisabled: boolean;
  readonly goal: string;
  readonly passageDrafts: Readonly<Record<string, string>>;
  readonly onPassageDraftChange: (sectionId: string, value: string) => void;
  readonly onMaterialUpdate: (material: StudyMaterial) => void;
  readonly onMaterialRemove: (materialId: string) => void;
  readonly onPassageSave: (material: StudyMaterial, sectionId: string, value: string) => void;
  readonly onPlan: (materialId: string, sectionId: string) => void;
  readonly onClaimChange: (
    planId: string,
    claim: StudyCoverageClaim,
    decision: StudyCoverageClaim["decision"],
    priority: StudyCoverageClaim["priority"],
  ) => void;
};

export function StudyMaterialsPanelSources({
  notebook,
  coverage,
  claimCoverage,
  disabled,
  networkDisabled,
  goal,
  passageDrafts,
  onPassageDraftChange,
  onMaterialUpdate,
  onMaterialRemove,
  onPassageSave,
  onPlan,
  onClaimChange,
}: StudyMaterialsPanelSourcesProps) {
  const materials = notebook.materials ?? [];
  return (
    <>
      {materials.length > 0 && <h4 className="text-sm font-semibold">Your sources</h4>}
      {materials.map((material) => (
        <article
          key={material.id}
          tabIndex={-1}
          data-search-target={`material:${material.id}`}
          className="space-y-4 border-b py-5"
        >
          <h4 className="text-sm font-semibold">{material.name}</h4>
          {material.warnings.map((warning, index) => (
            <Alert key={index} role="status">
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              onMaterialRemove(material.id);
            }}
          >
            Remove material
          </Button>
          {material.sections.map((section) => (
            <StudyMaterialSourceSection
              key={section.id}
              material={material}
              section={section}
              progress={coverage.find(
                (item) => item.materialId === material.id && item.sectionId === section.id,
              )}
              hasProposals={sectionHasProposals(notebook, material.id, section.id)}
              passageDraft={passageDrafts[section.id]}
              hasCoveragePlan={hasStudyCoveragePlan(
                notebook.coveragePlans,
                material.id,
                section.id,
              )}
              hasPassageDrafts={Object.keys(passageDrafts).length > 0}
              disabled={disabled}
              networkDisabled={networkDisabled}
              goal={goal}
              onMaterialUpdate={onMaterialUpdate}
              onPassageDraftChange={onPassageDraftChange}
              onPassageSave={onPassageSave}
              onPlan={onPlan}
              coveragePlans={notebook.coveragePlans}
              claimCoverage={claimCoverage}
              onClaimChange={onClaimChange}
            />
          ))}
        </article>
      ))}
    </>
  );
}
