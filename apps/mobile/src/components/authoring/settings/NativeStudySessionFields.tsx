import type { SchedulerSettings } from "@recall/domain";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import { Text, View } from "react-native";

export function NativeStudySessionFields({
  settings,
  disabled,
  onChange,
  workspace = false,
}: {
  readonly settings: SchedulerSettings;
  readonly disabled: boolean;
  readonly onChange: (settings: SchedulerSettings) => void;
  readonly workspace?: boolean;
}) {
  return (
    <View className="gap-3">
      {workspace && (
        <NativeTextField
          label="Study day starts at (local hour, 0–23)"
          editable={!disabled}
          keyboardType="number-pad"
          value={String(settings.studyDayStartHour ?? 0)}
          onChangeText={(text) => {
            onChange({ ...settings, studyDayStartHour: text.trim() ? Number(text) : NaN });
          }}
        />
      )}
      <NativeTextField
        label="Learn ahead when nothing else is due (minutes, 0–60)"
        editable={!disabled}
        keyboardType="number-pad"
        value={String(settings.learnAheadMinutes ?? 0)}
        onChangeText={(text) => {
          onChange({ ...settings, learnAheadMinutes: text.trim() ? Number(text) : NaN });
        }}
      />
      <NativeSelect
        label="Repeatedly failed cards"
        value={settings.leechAction ?? "notify"}
        disabled={disabled}
        options={[
          { label: "Flag for repair; keep reviewing", value: "notify" },
          { label: "Suspend until repaired or resumed", value: "suspend" },
        ]}
        onValueChange={(value) => {
          if (value === "notify" || value === "suspend")
            onChange({ ...settings, leechAction: value });
        }}
      />
      <Text className="text-sm text-recall-muted">
        Learning ahead is disabled at zero. Automatic suspension applies only to future failed
        reviews and is reversed by undo.
      </Text>
    </View>
  );
}
