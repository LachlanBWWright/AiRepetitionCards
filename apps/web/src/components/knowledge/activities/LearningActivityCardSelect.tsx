import {
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@recall/ui-web";
import type { LearningActivitiesProps } from "@/hooks/use-learning-activities";
export function LearningActivityCardSelect({
  cards,
  disabled,
  onSelect,
}: {
  readonly cards: NonNullable<LearningActivitiesProps["cards"]>;
  readonly disabled: boolean;
  readonly onSelect: (card: NonNullable<LearningActivitiesProps["cards"]>[number]) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="activity-existing-card">Practice an existing card</Label>
      <Select
        value=""
        disabled={disabled}
        onValueChange={(id) => {
          const card = cards.find((entry) => entry.id === id);
          if (card) onSelect(card);
        }}
      >
        <SelectTrigger id="activity-existing-card">
          <SelectValue placeholder="Choose a card" />
        </SelectTrigger>
        <SelectContent>
          {cards.map((card) => (
            <SelectItem key={card.id} value={card.id}>
              {card.front}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
