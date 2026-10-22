import { useId } from "react";
import type { KnowledgeArea } from "@recall/domain";
import { Label } from "@recall/ui-web/components/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@recall/ui-web/components/select";

export function ProposalObjectiveSelect({
  objectives,
  value,
  disabled,
  onChange,
}: {
  readonly objectives: KnowledgeArea["objectives"];
  readonly value: string | null;
  readonly disabled: boolean;
  readonly onChange: (value: string | null) => void;
}) {
  const id = useId();
  if (objectives.length === 0) return null;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Learning objective</Label>
      <Select
        value={value ?? "none"}
        disabled={disabled}
        onValueChange={(next) => {
          onChange(next === "none" ? null : next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No objective</SelectItem>
          {objectives.map((objective) => (
            <SelectItem key={objective.id} value={objective.id}>
              {objective.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
