import type { AreaSettings } from "@recall/application";
import { Textarea } from "@recall/ui-web";
import { Checkbox } from "@recall/ui-web/components/checkbox";

type Objective = AreaSettings["objectives"][number];
type Objectives = AreaSettings["objectives"];

type Props = {
  readonly objective: Objective;
  readonly objectives: Objectives;
  readonly onChange: (objectives: Objectives) => void;
};

const fieldStyle = { display: "grid", gap: 6 } as const;
const nullable = (value: string): string | null => (value.trim() ? value : null);

function togglePrerequisite(
  objective: Objective,
  prerequisiteId: Objective["id"],
  checked: boolean,
): Objective {
  const prerequisiteIds = checked
    ? [...objective.prerequisiteIds, prerequisiteId]
    : objective.prerequisiteIds.filter((id) => id !== prerequisiteId);
  return { ...objective, prerequisiteIds };
}

function toggleObjectivePrerequisite(
  objectives: Objectives,
  objectiveId: Objective["id"],
  prerequisiteId: Objective["id"],
  checked: boolean,
): Objectives {
  return objectives.map((item) =>
    item.id === objectiveId ? togglePrerequisite(item, prerequisiteId, checked) : item,
  );
}

function updateObjectiveDescription(
  objectives: Objectives,
  objectiveId: Objective["id"],
  description: string | null,
): Objectives {
  return objectives.map((item) => (item.id === objectiveId ? { ...item, description } : item));
}

function PrerequisiteChoices({ objective, objectives, onChange }: Props) {
  const choices = objectives.filter((item) => item.id !== objective.id);
  const updatePrerequisite = (prerequisiteId: Objective["id"], checked: boolean): void => {
    onChange(toggleObjectivePrerequisite(objectives, objective.id, prerequisiteId, checked));
  };

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
      <legend style={{ marginBottom: 8 }}>Prerequisites</legend>
      {objectives.length < 2 && <small>Add another objective to choose prerequisites.</small>}
      {choices.map((prerequisite) => (
        <label key={prerequisite.id} style={{ display: "flex", gap: 8 }}>
          <Checkbox
            checked={objective.prerequisiteIds.includes(prerequisite.id)}
            onCheckedChange={(checked) => {
              updatePrerequisite(prerequisite.id, checked === true);
            }}
          />
          {prerequisite.title || "Untitled objective"}
        </label>
      ))}
    </fieldset>
  );
}

export function KnowledgeAreaSettingsObjectiveDetails(props: Props) {
  const { objective, objectives, onChange } = props;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <label style={fieldStyle}>
        Description
        <Textarea
          rows={2}
          value={objective.description ?? ""}
          onChange={(event) => {
            onChange(
              updateObjectiveDescription(objectives, objective.id, nullable(event.target.value)),
            );
          }}
        />
      </label>
      <PrerequisiteChoices {...props} />
    </div>
  );
}
