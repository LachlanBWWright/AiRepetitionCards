import { Button, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import type {
  KnowledgeNotebook,
  StudyCoverageClaim,
  StudyMaterialCoverage,
} from "@recall/application";
import { StudyMaterialsPanelClaims } from "../../materials/StudyMaterialsPanelClaims";
import type { ClaimCoverage } from "../../materials/StudyMaterialsPanelSources";

type Material = NonNullable<KnowledgeNotebook["materials"]>[number];
type Section = Material["sections"][number];

export function StudyMaterialSourceSection({
  material,
  section,
  progress,
  hasProposals,
  passageDraft,
  hasCoveragePlan,
  hasPassageDrafts,
  disabled,
  networkDisabled,
  goal,
  onMaterialUpdate,
  onPassageDraftChange,
  onPassageSave,
  onPlan,
  coveragePlans,
  claimCoverage,
  onClaimChange,
}: {
  readonly material: Material;
  readonly section: Section;
  readonly progress: StudyMaterialCoverage | undefined;
  readonly hasProposals: boolean;
  readonly passageDraft: string | undefined;
  readonly hasCoveragePlan: boolean;
  readonly hasPassageDrafts: boolean;
  readonly disabled: boolean;
  readonly networkDisabled: boolean;
  readonly goal: string;
  readonly onMaterialUpdate: (material: Material) => void;
  readonly onPassageDraftChange: (sectionId: string, value: string) => void;
  readonly onPassageSave: (material: Material, sectionId: string, value: string) => void;
  readonly onPlan: (materialId: string, sectionId: string) => void;
  readonly coveragePlans: KnowledgeNotebook["coveragePlans"];
  readonly claimCoverage: readonly ClaimCoverage[];
  readonly onClaimChange: (
    planId: string,
    claim: StudyCoverageClaim,
    decision: StudyCoverageClaim["decision"],
    priority: StudyCoverageClaim["priority"],
  ) => void;
}) {
  const savePassage = () => {
    if (passageDraft?.trim()) onPassageSave(material, section.id, passageDraft);
  };
  const updateSelection = (checked: boolean) => {
    const sections = material.sections.map((item) =>
      item.id === section.id ? { ...item, selected: checked } : item,
    );
    onMaterialUpdate({ ...material, sections });
  };
  return (
    <section
      id={`study-source-${section.id}`}
      tabIndex={-1}
      data-search-target={`passage:${section.id}`}
    >
      <h3 className="text-sm font-semibold leading-6">
        {section.title}
        {section.pageNumber ? ` · page ${String(section.pageNumber)}` : ""} ·{" "}
        {progress?.status ?? "unprocessed"} · {progress?.approvedCards ?? 0} approved cards
      </h3>
      <div className="space-y-4 pt-3">
        <Label>
          <Checkbox
            checked={section.selected}
            disabled={disabled}
            onCheckedChange={(checked) => {
              updateSelection(checked === true);
            }}
          />
          Include this section
        </Label>
        <Label>
          Check extracted text
          <Textarea
            value={passageDraft ?? section.text}
            maxLength={12000}
            readOnly={hasProposals}
            disabled={disabled}
            onChange={(event) => {
              onPassageDraftChange(section.id, event.target.value);
            }}
          />
        </Label>
        {!hasProposals && passageDraft !== undefined && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !passageDraft.trim()}
            onClick={savePassage}
          >
            Save corrected passage
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={
            disabled || networkDisabled || hasPassageDrafts || !goal.trim() || hasCoveragePlan
          }
          onClick={() => {
            onPlan(material.id, section.id);
          }}
        >
          Suggest topics
        </Button>
        <StudyMaterialsPanelClaims
          plans={(coveragePlans ?? []).filter(
            (plan) => plan.materialId === material.id && plan.sectionId === section.id,
          )}
          claimCoverage={claimCoverage}
          disabled={disabled}
          onClaimChange={onClaimChange}
        />
        {hasProposals && (
          <p>
            This passage is preserved because cards cite it. Import corrected text as a new source.
          </p>
        )}
      </div>
    </section>
  );
}

export function hasStudyCoveragePlan(
  plans: KnowledgeNotebook["coveragePlans"],
  materialId: string,
  sectionId: string,
): boolean {
  return (plans ?? []).some(
    (plan) => plan.materialId === materialId && plan.sectionId === sectionId,
  );
}
