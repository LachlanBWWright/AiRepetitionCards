import { Button, Input, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import type { KnowledgeNotebook, StudyCoverageClaim } from "@recall/application";

type Suggestion = { readonly title: string; readonly description: string };
type Depth = "overview" | "standard" | "detailed";
type ClaimCoverage = StudyCoverageClaim & {
  readonly planId: string;
  readonly claimId: string;
  readonly materialId: string;
  readonly sectionId: string;
  readonly status: "pending" | "skipped" | "uncovered" | "proposed" | "covered";
  readonly pendingCards: number;
  readonly approvedCards: number;
};
type SelectedSource = {
  readonly material: NonNullable<KnowledgeNotebook["materials"]>[number];
  readonly section: NonNullable<KnowledgeNotebook["materials"]>[number]["sections"][number];
};

export type StudyMaterialsPanelGenerationProps = {
  readonly notebook: KnowledgeNotebook;
  readonly disabled: boolean;
  readonly networkDisabled: boolean;
  readonly goal: string;
  readonly onGoalChange: (value: string) => void;
  readonly depth: Depth;
  readonly onDepthChange: (value: Depth) => void;
  readonly conceptId: string;
  readonly onConceptChange: (value: string) => void;
  readonly count: string;
  readonly onCountChange: (value: string) => void;
  readonly selectedCount: number;
  readonly claimCoverage: readonly ClaimCoverage[];
  readonly passageDraftsExist: boolean;
  readonly suggestions: readonly Suggestion[];
  readonly onGenerate: () => void;
  readonly onStop: () => void;
  readonly onAddSuggestion: (suggestion: Suggestion) => void;
};

function isSuggestionAlreadyPresent(notebook: KnowledgeNotebook, suggestion: Suggestion): boolean {
  const normalizedTitle = suggestion.title.toLowerCase();
  return notebook.concepts.some((concept) => concept.title.toLowerCase() === normalizedTitle);
}

function hasSelectedUncoveredClaim(
  claims: readonly ClaimCoverage[],
  selected: readonly SelectedSource[],
): boolean {
  return claims.some(
    (claim) =>
      claim.decision === "selected" &&
      claim.status === "uncovered" &&
      selected.some(
        (source) =>
          source.material.id === claim.materialId && source.section.id === claim.sectionId,
      ),
  );
}

export function StudyMaterialsPanelGeneration({
  notebook,
  disabled,
  networkDisabled,
  goal,
  onGoalChange,
  depth,
  onDepthChange,
  conceptId,
  onConceptChange,
  count,
  onCountChange,
  selectedCount,
  claimCoverage,
  passageDraftsExist,
  suggestions,
  onGenerate,
  onStop,
  onAddSuggestion,
}: StudyMaterialsPanelGenerationProps) {
  const selected = (notebook.materials ?? []).flatMap((material) =>
    material.sections
      .filter((section) => section.selected)
      .map((section) => ({ material, section })),
  );
  return (
    <div className="grid gap-5 rounded-xl border bg-card p-5 sm:p-6">
      <h4 className="text-sm font-semibold">Generate cards</h4>
      <Label>
        Study goal
        <Textarea
          disabled={disabled}
          value={goal}
          maxLength={2000}
          onChange={(event) => {
            onGoalChange(event.target.value);
          }}
        />
      </Label>
      <Label>
        Depth
        <Select
          disabled={disabled}
          value={depth}
          onValueChange={(value) => {
            if (value === "overview" || value === "standard" || value === "detailed")
              onDepthChange(value);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Depth">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="overview">Overview · central ideas</SelectItem>
            <SelectItem value="standard">Standard · explanations and distinctions</SelectItem>
            <SelectItem value="detailed">Detailed · application and edge cases</SelectItem>
          </SelectContent>
        </Select>
      </Label>
      <Label>
        Link cards to concept
        <Select
          disabled={disabled}
          value={conceptId}
          onValueChange={(value) => {
            onConceptChange(value);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Link cards to concept">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {notebook.concepts.map((concept) => (
              <SelectItem key={concept.id} value={concept.id}>
                {concept.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      <Label>
        Maximum cards
        <Input
          type="number"
          min={1}
          max={100}
          value={count}
          disabled={disabled}
          onChange={(event) => {
            onCountChange(event.target.value);
          }}
        />
      </Label>
      <p>{selectedCount} sections selected. Selected passages are sent to your AI provider.</p>
      <Button
        type="button"
        variant="default"
        disabled={
          disabled ||
          networkDisabled ||
          !selected.length ||
          !goal.trim() ||
          ((notebook.coveragePlans?.length ?? 0) > 0 &&
            !hasSelectedUncoveredClaim(claimCoverage, selected)) ||
          passageDraftsExist
        }
        onClick={onGenerate}
      >
        Generate cards
      </Button>
      <Button type="button" variant="outline" onClick={onStop}>
        Stop after current request
      </Button>
      {suggestions.map((suggestion) => (
        <article key={suggestion.title}>
          <strong>{suggestion.title}</strong>
          <p>{suggestion.description}</p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || isSuggestionAlreadyPresent(notebook, suggestion)}
            onClick={() => {
              onAddSuggestion(suggestion);
            }}
          >
            Add concept
          </Button>
        </article>
      ))}
    </div>
  );
}
