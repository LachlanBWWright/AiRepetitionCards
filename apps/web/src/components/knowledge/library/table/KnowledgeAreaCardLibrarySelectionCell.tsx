import { Checkbox } from "@recall/ui-web/components/checkbox";

type KnowledgeAreaCardLibrarySelectionCellProps = {
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
};

export function KnowledgeAreaCardLibrarySelectionCell({
  selected,
  disabled,
  label,
  onChange,
}: KnowledgeAreaCardLibrarySelectionCellProps) {
  return (
    <td className="px-3 py-3">
      <Checkbox
        checked={selected}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={(checked) => {
          onChange(checked === true);
        }}
      />
    </td>
  );
}
