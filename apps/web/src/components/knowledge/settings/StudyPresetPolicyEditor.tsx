import { Effect, Either } from "effect";
import type { SchedulerPolicy, SchedulerSettings, Workspace } from "@recall/domain";
import { presetReviewWorkspace, renameStudyPreset, removeStudyPreset } from "@recall/application";
import { Input, FieldLabel } from "@recall/ui-web";
import { Button } from "@/components/ui/Button";
import { StudyPolicyFields } from "./StudyPolicyFields";
import { AdvancedSchedulingFields } from "./AdvancedSchedulingFields";
import { ParameterFittingPanel } from "./ParameterFittingPanel";

export function StudyPresetPolicyEditor({
  workspace,
  settings,
  selected,
  onChange,
  onPolicyChange,
  onDeleted,
}: {
  readonly workspace: Workspace;
  readonly settings: SchedulerSettings;
  readonly selected: NonNullable<SchedulerSettings["presets"]>[number];
  readonly onChange: (settings: SchedulerSettings) => void;
  readonly onPolicyChange: (policy: SchedulerPolicy) => void;
  readonly onDeleted: () => void;
}) {
  const fitWorkspace = presetReviewWorkspace(
    { ...workspace, schedulerSettings: settings },
    selected.id,
  );
  return (
    <div className="flex flex-col gap-4 border-l-2 pl-4">
      <FieldLabel className="flex min-w-0 flex-col gap-2">
        Preset name
        <Input
          value={selected.name}
          onChange={(event) => {
            onChange(renameStudyPreset(settings, selected.id, event.target.value));
          }}
        />
      </FieldLabel>
      <FieldLabel className="flex min-w-0 flex-col gap-2">
        Target retention (%)
        <Input
          type="number"
          min={70}
          max={97}
          step={0.1}
          required
          value={selected.settings.requestRetention * 100}
          onChange={(event) => {
            onPolicyChange({
              ...selected.settings,
              requestRetention: Number(event.target.value) / 100,
            });
          }}
        />
      </FieldLabel>
      <StudyPolicyFields
        showTodayLimits={false}
        settings={selected.settings}
        onChange={onPolicyChange}
      />
      <AdvancedSchedulingFields
        key={selected.id}
        policy={selected.settings}
        onChange={onPolicyChange}
      />
      <ParameterFittingPanel
        key={`fit-${selected.id}`}
        workspace={fitWorkspace}
        settings={selected.settings}
        onChange={onPolicyChange}
      />
      <Button
        type="button"
        variant="default"
        disabled={Object.values(settings.areaPresets ?? {}).includes(selected.id)}
        onClick={() => {
          const next = Effect.runSync(Effect.either(removeStudyPreset(settings, selected.id)));
          if (Either.isLeft(next)) return;
          onChange(next.right);
          onDeleted();
        }}
      >
        Delete unassigned preset
      </Button>
    </div>
  );
}
