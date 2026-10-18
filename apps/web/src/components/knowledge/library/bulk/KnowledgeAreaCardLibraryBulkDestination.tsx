import type { Workspace } from "@recall/domain";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@recall/ui-web";

type KnowledgeAreaCardLibraryBulkDestinationProps = {
  readonly workspace: Workspace | undefined;
  readonly currentAreaId: string;
  readonly destination: string;
  readonly disabled: boolean;
  readonly onDestinationChange: (value: string) => void;
};

export function KnowledgeAreaCardLibraryBulkDestination({
  workspace,
  currentAreaId,
  destination,
  disabled,
  onDestinationChange,
}: KnowledgeAreaCardLibraryBulkDestinationProps) {
  return (
    <label>
      Destination deck
      <Select value={destination} onValueChange={onDestinationChange} disabled={disabled}>
        <SelectTrigger aria-label="Destination deck">
          <SelectValue placeholder="Choose a deck" />
        </SelectTrigger>
        <SelectContent>
          {workspace?.areas
            .filter((item) => item.id !== currentAreaId)
            .map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.title}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </label>
  );
}
