import type { Workspace } from "@recall/domain";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@recall/ui-web";
import type { KnowledgeAreaCardLibraryDuplicateScope } from "../KnowledgeAreaCardLibraryDerivations";

type KnowledgeAreaCardLibraryDuplicateScopeProps = {
  readonly fieldId: string;
  readonly workspace: Workspace | undefined;
  readonly value: KnowledgeAreaCardLibraryDuplicateScope;
  readonly onChange: (value: string) => void;
};

export function KnowledgeAreaCardLibraryDuplicateScopeSelect({
  fieldId,
  workspace,
  value,
  onChange,
}: KnowledgeAreaCardLibraryDuplicateScopeProps) {
  if (!workspace) return null;

  return (
    <label htmlFor={`${fieldId}-duplicate-scope`}>
      Look in{" "}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={`${fieldId}-duplicate-scope`} aria-label="Duplicate search scope">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="area">This area</SelectItem>
          <SelectItem value="workspace">All areas</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}
