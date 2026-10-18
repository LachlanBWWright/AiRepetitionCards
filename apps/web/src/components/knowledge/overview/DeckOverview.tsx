import type { LearningArea } from "@recall/domain";
import { DeckOverviewRow } from "./DeckOverviewRow";

export function DeckOverview({
  areas,
  now,
  onOpen,
  onEdit,
  onSettings,
  onDelete,
  disabled = false,
}: {
  readonly areas: readonly LearningArea[];
  readonly now: number;
  readonly onOpen: (id: string) => void;
  readonly onEdit?: (area: LearningArea) => void;
  readonly onSettings?: (area: LearningArea) => void;
  readonly onDelete?: (area: LearningArea) => void;
  readonly disabled?: boolean;
}) {
  if (areas.length === 0) return null;
  return (
    <section aria-label="Your decks" className="overflow-hidden rounded-xl border bg-card">
      <ul className="divide-y divide-border">
        {areas.map((area) => (
          <DeckOverviewRow
            key={area.id}
            area={area}
            now={now}
            onOpen={onOpen}
            {...(onEdit ? { onEdit } : {})}
            {...(onSettings ? { onSettings } : {})}
            {...(onDelete ? { onDelete } : {})}
            disabled={disabled}
          />
        ))}
      </ul>
    </section>
  );
}
