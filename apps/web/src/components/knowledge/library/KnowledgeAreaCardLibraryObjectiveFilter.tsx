import type { LearningArea } from "@recall/domain";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@recall/ui-web";

type KnowledgeAreaCardLibraryObjectiveFilterProps = {
  readonly fieldId: string;
  readonly objectives: NonNullable<LearningArea["objectives"]>;
  readonly legacyObjectives: readonly string[];
  readonly value: string;
  readonly onChange: (value: string) => void;
};

export function KnowledgeAreaCardLibraryObjectiveFilter({
  fieldId,
  objectives,
  legacyObjectives,
  value,
  onChange,
}: KnowledgeAreaCardLibraryObjectiveFilterProps) {
  if (objectives.length === 0 && legacyObjectives.length === 0) return null;

  return (
    <label htmlFor={`${fieldId}-objective`} className="w-full sm:w-52">
      <span className="sr-only">Learning objective</span>
      <Select value={value || "all"} onValueChange={onChange}>
        <SelectTrigger id={`${fieldId}-objective`} aria-label="Learning objective">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All objectives</SelectItem>
          {objectives.map((objective) => (
            <SelectItem key={objective.id} value={`id:${objective.id}`}>
              {objective.title}
            </SelectItem>
          ))}
          {legacyObjectives.map((title) => (
            <SelectItem key={title} value={`title:${title}`}>
              {title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
