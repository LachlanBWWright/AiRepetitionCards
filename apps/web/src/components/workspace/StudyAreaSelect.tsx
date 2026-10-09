import type { ReactNode } from "react";
import type { LearningArea } from "@/features/workspace/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";

type StudyAreaSelectProps = {
  readonly areas: readonly LearningArea[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly renderDetail?: (area: LearningArea) => ReactNode;
};

export function StudyAreaSelect({
  areas,
  value,
  onValueChange,
  disabled = false,
  ariaLabel = "Study area",
  placeholder = "Choose an area",
  renderDetail,
}: StudyAreaSelectProps) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onValueChange}>
      <SelectTrigger className="w-64" aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="w-[var(--radix-select-trigger-width)]">
        {areas.map((area) => (
          <SelectItem key={area.id} value={area.id}>
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: area.color }}
              />
              <span className="truncate">{area.title}</span>
              {renderDetail?.(area)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
