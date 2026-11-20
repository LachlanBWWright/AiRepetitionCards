import { TodayStudyLimits } from "./TodayStudyLimits";
import { useStudyPresets } from "@recall/react";
import { assignStudyGroup } from "@recall/application";
import type { SchedulerSettings, Workspace } from "@recall/domain";
import { Input, FieldLabel, FieldDescription } from "@recall/ui-web";
import { Button } from "@/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import { StudyPresetPolicyEditor } from "./StudyPresetPolicyEditor";

export function StudyPresetEditor({
  workspace,
  settings,
  onChange,
}: {
  readonly workspace: Workspace;
  readonly settings: SchedulerSettings;
  readonly onChange: (settings: SchedulerSettings) => void;
}) {
  const {
    name,
    setName,
    presets,
    selectedId,
    setSelectedId,
    selected,
    create,
    canCreate,
    changePolicy,
  } = useStudyPresets(settings, onChange);
  const assignmentRows = workspace.areas.map((area) => (
    <SubjectAssignment
      key={area.id}
      areaId={area.id}
      workspace={workspace}
      settings={settings}
      onChange={onChange}
    />
  ));
  const presetOptions = presets.map((preset) => (
    <SelectItem key={preset.id} value={preset.id}>
      {preset.name}
    </SelectItem>
  ));
  return (
    <section className="flex flex-col gap-4" aria-label="Subject presets">
      <h3 className="m-0 font-semibold">Subject presets and groups</h3>
      <FieldDescription>
        A subject inherits its parent’s preset until assigned its own. Subject and parent budgets
        also respect the workspace-wide daily limit above. Save settings to apply.
      </FieldDescription>
      <FieldLabel className="flex min-w-0 flex-col gap-2">
        New preset name
        <Input
          value={name}
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </FieldLabel>
      <Button type="button" variant="default" disabled={!canCreate} onClick={create}>
        Create preset from workspace defaults
      </Button>
      {presets.length > 0 && (
        <>
          <Select value={selectedId || presets[0]?.id} onValueChange={setSelectedId}>
            <SelectTrigger className="w-full" aria-label="Edit preset">
              <SelectValue placeholder="Choose preset" />
            </SelectTrigger>
            <SelectContent>{presetOptions}</SelectContent>
          </Select>
          {selected && (
            <StudyPresetPolicyEditor
              workspace={workspace}
              settings={settings}
              selected={selected}
              onChange={onChange}
              onPolicyChange={changePolicy}
              onDeleted={() => {
                setSelectedId("");
              }}
            />
          )}
        </>
      )}
      <Accordion type="single" collapsible>
        <AccordionItem value="assignments">
          <AccordionTrigger>Assign presets and parent subjects</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-4">{assignmentRows}</div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
function SubjectAssignment({
  areaId,
  workspace,
  settings,
  onChange,
}: {
  readonly areaId: string;
  readonly workspace: Workspace;
  readonly settings: SchedulerSettings;
  readonly onChange: (settings: SchedulerSettings) => void;
}) {
  const update = (field: "areaPresets" | "areaParents", value: string) => {
    onChange(assignStudyGroup(settings, areaId, field, value === "inherit" ? undefined : value));
  };
  return (
    <div className="flex flex-col gap-2 border-b pb-3">
      <FieldLabel className="flex min-w-0 flex-col gap-2">
        Subject returning-card limit (blank inherits)
        <Input
          type="number"
          min={0}
          max={10000}
          value={settings.areaReviewLimits?.[areaId] ?? ""}
          onChange={(event) => {
            const rest = Object.fromEntries(
              Object.entries(settings.areaReviewLimits ?? {}).filter(([id]) => id !== areaId),
            );
            onChange({
              ...settings,
              areaReviewLimits: {
                ...rest,
                ...(event.target.value.trim() ? { [areaId]: Number(event.target.value) } : {}),
              },
            });
          }}
        />
      </FieldLabel>
      <TodayStudyLimits
        settings={settings}
        onChange={onChange}
        areaId={workspace.areas.find((area) => area.id === areaId)?.id}
      />
      <p className="m-0 font-medium">{workspace.areas.find((area) => area.id === areaId)?.title}</p>
      <Select
        value={settings.areaPresets?.[areaId] ?? "inherit"}
        onValueChange={(value) => {
          update("areaPresets", value);
        }}
      >
        <SelectTrigger className="w-full" aria-label="Subject preset">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">Inherit defaults or parent</SelectItem>
          {settings.presets?.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {preset.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={settings.areaParents?.[areaId] ?? "inherit"}
        onValueChange={(value) => {
          update("areaParents", value);
        }}
      >
        <SelectTrigger className="w-full" aria-label="Parent subject">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">No parent subject</SelectItem>
          {workspace.areas
            .filter((area) => area.id !== areaId)
            .map((area) => (
              <SelectItem key={area.id} value={area.id}>
                {area.title}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}
