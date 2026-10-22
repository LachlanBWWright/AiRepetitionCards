import { NativeTodayStudyLimits } from "./NativeTodayStudyLimits";
import { NativeStudyPolicyFields } from "./NativeStudyPolicyFields";
import { assignStudyGroup } from "@recall/application";
import { NativeParameterFitting } from "./NativeParameterFitting";
import { useStudyPresets } from "@recall/react";
import { Text, View } from "react-native";
import type { SchedulerSettings, Workspace } from "@recall/domain";
import { presetReviewWorkspace } from "@recall/application";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import { NativeButton } from "../../ui/NativeButton";
import { NativeAdvancedScheduling } from "./NativeAdvancedScheduling";

export function NativeStudyPresets({
  workspace,
  settings,
  disabled,
  onChange,
}: {
  readonly workspace: Workspace;
  readonly settings: SchedulerSettings;
  readonly disabled: boolean;
  readonly onChange: (settings: SchedulerSettings) => void;
}) {
  const {
    name,
    setName,
    presets,
    selected,
    setSelectedId,
    create,
    canCreate,
    changePolicy: updatePolicy,
    rename,
    deleteSelected,
  } = useStudyPresets(settings, onChange);
  const assignments = workspace.areas.map((area) => (
    <NativePresetAssignment
      key={area.id}
      workspace={workspace}
      areaId={area.id}
      settings={settings}
      disabled={disabled}
      onChange={onChange}
    />
  ));
  return (
    <View className="gap-3 border-t border-recall-line pt-3">
      <Text className="font-bold text-recall-ink">Subject presets and groups</Text>
      <Text className="text-sm text-recall-muted">
        Subjects inherit their parent’s preset until assigned their own. Parent and subject budgets
        respect the workspace limit. Save review settings to apply changes.
      </Text>
      <NativeTextField
        label="New preset name"
        value={name}
        maxLength={80}
        editable={!disabled}
        onChangeText={setName}
      />
      <NativeButton
        label="Create preset from defaults"
        tone="soft"
        disabled={disabled || !canCreate}
        onPress={create}
      />
      {selected && (
        <View className="gap-3">
          <NativeSelect
            label="Edit preset"
            disabled={disabled}
            value={selected.id}
            options={presets.map((preset) => ({ label: preset.name, value: preset.id }))}
            onValueChange={setSelectedId}
          />
          <NativeTextField
            label="Preset name"
            value={selected.name}
            editable={!disabled}
            onChangeText={(value) => {
              rename(value);
            }}
          />
          <NativeTextField
            label="Preset retention (%)"
            keyboardType="decimal-pad"
            editable={!disabled}
            value={String(selected.settings.requestRetention * 100)}
            onChangeText={(value) => {
              updatePolicy({ ...selected.settings, requestRetention: Number(value) / 100 });
            }}
          />
          <NativeStudyPolicyFields
            policy={selected.settings}
            disabled={disabled}
            onChange={updatePolicy}
          />
          <NativeAdvancedScheduling
            key={selected.id}
            policy={selected.settings}
            disabled={disabled}
            onChange={updatePolicy}
          />
          <NativeParameterFitting
            key={`fit-${selected.id}`}
            workspace={presetReviewWorkspace(
              { ...workspace, schedulerSettings: settings },
              selected.id,
            )}
            settings={selected.settings}
            disabled={disabled}
            onChange={updatePolicy}
          />
          <NativeButton
            label="Delete unassigned preset"
            tone="soft"
            disabled={disabled || Object.values(settings.areaPresets ?? {}).includes(selected.id)}
            onPress={deleteSelected}
          />
        </View>
      )}
      {assignments}
    </View>
  );
}
function NativePresetAssignment({
  workspace,
  areaId,
  settings,
  disabled,
  onChange,
}: {
  readonly workspace: Workspace;
  readonly areaId: string;
  readonly settings: SchedulerSettings;
  readonly disabled: boolean;
  readonly onChange: (settings: SchedulerSettings) => void;
}) {
  const update = (field: "areaPresets" | "areaParents", value: string) => {
    onChange(assignStudyGroup(settings, areaId, field, value === "inherit" ? undefined : value));
  };
  return (
    <View className="gap-2 border-t border-recall-line pt-3">
      <NativeTextField
        label="Subject returning-card limit (blank inherits)"
        keyboardType="number-pad"
        editable={!disabled}
        value={String(settings.areaReviewLimits?.[areaId] ?? "")}
        onChangeText={(value) => {
          const rest = Object.fromEntries(
            Object.entries(settings.areaReviewLimits ?? {}).filter(([id]) => id !== areaId),
          );
          onChange({
            ...settings,
            areaReviewLimits: { ...rest, ...(value.trim() ? { [areaId]: Number(value) } : {}) },
          });
        }}
      />
      <NativeTodayStudyLimits
        settings={settings}
        disabled={disabled}
        onChange={onChange}
        areaId={workspace.areas.find((area) => area.id === areaId)?.id}
      />
      <Text>{workspace.areas.find((area) => area.id === areaId)?.title}</Text>
      <NativeSelect
        label="Subject preset"
        disabled={disabled}
        value={settings.areaPresets?.[areaId] ?? "inherit"}
        options={[
          { label: "Inherit defaults or parent", value: "inherit" },
          ...(settings.presets ?? []).map((preset) => ({ label: preset.name, value: preset.id })),
        ]}
        onValueChange={(value) => {
          update("areaPresets", value);
        }}
      />
      <NativeSelect
        label="Parent subject"
        disabled={disabled}
        value={settings.areaParents?.[areaId] ?? "inherit"}
        options={[
          { label: "No parent", value: "inherit" },
          ...workspace.areas
            .filter((area) => area.id !== areaId)
            .map((area) => ({ label: area.title, value: area.id })),
        ]}
        onValueChange={(value) => {
          update("areaParents", value);
        }}
      />
    </View>
  );
}
