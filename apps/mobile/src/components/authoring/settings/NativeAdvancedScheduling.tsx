import { toggleEasyDay } from "@recall/application";
import { useSchedulingSteps } from "@recall/react";
import { Text, View } from "react-native";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import type { SchedulerPolicy } from "@recall/domain";

export function NativeAdvancedScheduling({
  policy,
  disabled,
  onChange,
}: {
  readonly policy: SchedulerPolicy;
  readonly disabled: boolean;
  readonly onChange: (policy: SchedulerPolicy) => void;
}) {
  const { learning, relearning, updateSteps } = useSchedulingSteps(policy, onChange);
  return (
    <View className="gap-3 border-t border-recall-line pt-3">
      <Text className="font-bold text-recall-ink">Scheduling adjustments</Text>
      <NativeTextField
        label="Learning steps · minutes, e.g. 1 10"
        value={learning}
        editable={!disabled}
        onChangeText={(value) => {
          updateSteps(value, "learningSteps");
        }}
      />
      <NativeTextField
        label="Relearning steps · minutes"
        value={relearning}
        editable={!disabled}
        onChangeText={(value) => {
          updateSteps(value, "relearningSteps");
        }}
      />
      <Text className="text-sm text-recall-muted">
        Use up to five increasing whole-minute delays. Leave blank for FSRS-controlled scheduling.
      </Text>
      <NativeTextField
        label="Maximum interval · days"
        value={Number.isNaN(policy.maximumInterval) ? "" : String(policy.maximumInterval ?? 36500)}
        keyboardType="number-pad"
        editable={!disabled}
        onChangeText={(value) => {
          onChange({ ...policy, maximumInterval: value.trim() ? Number(value) : NaN });
        }}
      />
      <NativeSelect
        label="New cards and reviews"
        disabled={disabled}
        value={policy.newReviewOrder ?? "after"}
        options={[
          { label: "New cards after reviews", value: "after" },
          { label: "New cards before reviews", value: "before" },
          { label: "Mix by due date", value: "mix" },
        ]}
        onValueChange={(value) => {
          if (value === "after" || value === "before" || value === "mix")
            onChange({ ...policy, newReviewOrder: value });
        }}
      />
      <NativeSelect
        label="Review order"
        disabled={disabled}
        value={policy.reviewOrder ?? "due"}
        options={[
          { label: "Oldest due first", value: "due" },
          { label: "Lowest recall first", value: "retrievability" },
          { label: "Shortest intervals first", value: "interval-ascending" },
          { label: "Longest intervals first", value: "interval-descending" },
        ]}
        onValueChange={(value) => {
          if (
            value === "due" ||
            value === "retrievability" ||
            value === "interval-ascending" ||
            value === "interval-descending"
          )
            onChange({ ...policy, reviewOrder: value });
        }}
      />
      <NativeTextField
        label="Scheduling time zone"
        value={policy.timeZone ?? "UTC"}
        editable={!disabled}
        autoCapitalize="none"
        onChangeText={(value) => {
          onChange({ ...policy, timeZone: value });
        }}
      />
      <Text className="text-sm text-recall-muted">
        Reduced-load days shift review intervals by at most two days when possible. Existing due
        dates stay unchanged.
      </Text>
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
        <NativeSelect
          key={day}
          label={day}
          disabled={disabled}
          value={policy.easyDays?.includes(index) ? "reduced" : "normal"}
          options={[
            { label: "Normal", value: "normal" },
            { label: "Reduced load", value: "reduced" },
          ]}
          onValueChange={(value) => {
            onChange(toggleEasyDay(policy, index, value === "reduced"));
          }}
        />
      ))}
    </View>
  );
}
