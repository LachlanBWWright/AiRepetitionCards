import type { AreaSettings } from "@recall/application";
import { Button } from "@/components/ui/Button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import { Input, FieldLabel, Tooltip, TooltipContent, TooltipTrigger } from "@recall/ui-web";
import { KnowledgeAreaSettingsObjectiveDetails } from "./KnowledgeAreaSettingsObjectiveDetails";

type Objective = AreaSettings["objectives"][number];

type Props = {
  readonly objectives: AreaSettings["objectives"];
  readonly onChange: (objectives: AreaSettings["objectives"]) => void;
  readonly onAdd: () => void;
  readonly prefix: string;
};

const fieldStyle = { display: "flex", flexDirection: "column", gap: 8 } as const;
const panelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  border: 0,
  padding: 0,
} as const;
function updateObjective(
  objectives: AreaSettings["objectives"],
  objectiveId: Objective["id"],
  update: (objective: Objective) => Objective,
): AreaSettings["objectives"] {
  return objectives.map((objective) =>
    objective.id === objectiveId ? update(objective) : objective,
  );
}

function updateObjectiveTitle(
  objectives: AreaSettings["objectives"],
  objectiveId: Objective["id"],
  title: string,
): AreaSettings["objectives"] {
  return updateObjective(objectives, objectiveId, (item) => ({ ...item, title }));
}

function removeObjective(
  objectives: AreaSettings["objectives"],
  objectiveId: Objective["id"],
): AreaSettings["objectives"] {
  const remaining = objectives.filter((item) => item.id !== objectiveId);
  return remaining.map((item) => ({
    ...item,
    prerequisiteIds: item.prerequisiteIds.filter((id) => id !== objectiveId),
  }));
}

function ObjectiveDetailsAccordion({
  objective,
  objectives,
  onChange,
}: {
  readonly objective: Objective;
  readonly objectives: AreaSettings["objectives"];
  readonly onChange: Props["onChange"];
}) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value={`objective-${objective.id}`} className="border-b-0">
        <AccordionTrigger>Description and prerequisites</AccordionTrigger>
        <AccordionContent>
          <KnowledgeAreaSettingsObjectiveDetails
            objective={objective}
            objectives={objectives}
            onChange={onChange}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function KnowledgeAreaSettingsObjectives({ objectives, onChange, onAdd, prefix }: Props) {
  return (
    <section aria-labelledby={`${prefix}-objectives`} style={panelStyle}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="m-0 text-base font-semibold" id={`${prefix}-objectives`}>
          Learning objectives
        </h3>
        <Button
          type="button"
          variant="default"
          size="default"
          onClick={onAdd}
          disabled={objectives.length >= 200}
        >
          Add objective
        </Button>
      </div>
      {objectives.length === 0 && <p style={{ margin: 0 }}>No objectives yet.</p>}
      {objectives.map((objective, index) => (
        <section
          key={objective.id}
          aria-label={`Objective ${String(index + 1)}`}
          className="flex min-w-0 flex-col gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Objective {index + 1}</span>
            <RemoveObjectiveButton
              onRemove={() => {
                onChange(removeObjective(objectives, objective.id));
              }}
            />
          </div>
          <FieldLabel style={fieldStyle}>
            Title
            <Input
              required
              value={objective.title}
              onChange={(event) => {
                onChange(updateObjectiveTitle(objectives, objective.id, event.target.value));
              }}
            />
          </FieldLabel>
          <ObjectiveDetailsAccordion
            objective={objective}
            objectives={objectives}
            onChange={onChange}
          />
        </section>
      ))}
    </section>
  );
}

function RemoveObjectiveButton({ onRemove }: { readonly onRemove: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="default" size="sm" onClick={onRemove}>
          Remove objective
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Unlink this objective from cards without deleting their review history
      </TooltipContent>
    </Tooltip>
  );
}
