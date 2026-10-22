import { Effect, Either } from "effect";
import type { SchedulerPolicy, SchedulerSettings, Workspace } from "@recall/domain";
import { presetReviewWorkspace, renameStudyPreset, removeStudyPreset } from "@recall/application";
import { Input } from "@recall/ui-web";
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
    <div className="grid gap-3 border-l-2 pl-4">
      <label>
        Preset name
        <Input
          value={selected.name}
          onChange={(event) => {
            onChange(renameStudyPreset(settings, selected.id, event.target.value));
          }}
        />
      </label>
      <label>
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
      </label>
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
        variant="secondary"
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
