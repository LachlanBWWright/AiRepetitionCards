import { Label } from "@recall/ui-web/components/label";
import type { LearningArea } from "@recall/domain";
import type { NoteAuthoringModel } from "@recall/react";
import { Checkbox } from "@recall/ui-web/components/checkbox";

export function NoteObjectives({
  area,
  model,
}: {
  readonly area: LearningArea;
  readonly model: NoteAuthoringModel;
}) {
  if (!area.objectives?.length) return null;
  return (
    <fieldset className="grid gap-2">
      <legend>Learning objectives</legend>
      {area.objectives.map((objective) => (
        <Label key={objective.id} className="flex items-center gap-2">
          <Checkbox
            checked={model.note.objectiveIds.includes(objective.id)}
            onCheckedChange={() => {
              model.toggleObjective(objective.id);
            }}
          />
          {objective.title}
        </Label>
      ))}
    </fieldset>
  );
}
