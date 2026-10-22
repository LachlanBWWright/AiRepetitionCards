import type { NoteAuthoringModel } from "@recall/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
export function NoteTemplateDeck({
  model,
  templateId,
}: {
  readonly model: NoteAuthoringModel;
  readonly templateId: string;
}) {
  const template = model.type.templates.find((item) => item.id === templateId);
  return (
    <label className="grid gap-1 text-sm">
      Card subject
      <Select
        value={template?.deckAreaId ?? model.area.id}
        onValueChange={(id) => {
          const area = model.availableAreas.find((item) => item.id === id);
          if (area)
            model.updateTemplate(templateId, {
              deckAreaId: area.id === model.area.id ? undefined : area.id,
            });
        }}
      >
        <SelectTrigger aria-label="Card subject">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {model.availableAreas.map((area) => (
            <SelectItem key={area.id} value={area.id}>
              {area.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
