import { Checkbox } from "@recall/ui-web/components/checkbox";

type KnowledgeAreaCardLibrarySelectionHeaderProps = {
  readonly allSelected: boolean;
  readonly someSelected: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
};

export function KnowledgeAreaCardLibrarySelectionHeader({
  allSelected,
  someSelected,
  disabled,
  onChange,
}: KnowledgeAreaCardLibrarySelectionHeaderProps) {
  return (
    <th scope="col" className="w-12 px-3 py-3">
      <Checkbox
        aria-label="Select visible cards"
        disabled={disabled}
        checked={allSelected ? true : someSelected ? "indeterminate" : false}
        onCheckedChange={(checked) => {
          onChange(checked === true);
        }}
      />
    </th>
  );
}
