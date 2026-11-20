import { ToggleGroup, ToggleGroupItem } from "@recall/ui-web";

const rubricScores = [
  { value: 0, label: "Needs work" },
  { value: 0.5, label: "Partially meets rubric" },
  { value: 1, label: "Meets rubric" },
] as const;

export function RubricScoreSelect({
  value,
  disabled,
  onSelect,
}: {
  readonly value: number | undefined;
  readonly disabled: boolean;
  readonly onSelect: (score: number) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value === undefined ? "" : String(value)}
      disabled={disabled}
      aria-label="How does your response meet the rubric?"
      className="flex flex-wrap gap-2"
      onValueChange={(selected) => {
        const score = rubricScores.find((entry) => String(entry.value) === selected);
        if (score) onSelect(score.value);
      }}
    >
      {rubricScores.map((score) => (
        <ToggleGroupItem
          key={score.value}
          value={String(score.value)}
          className="min-h-9 border-input whitespace-normal"
        >
          {score.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
