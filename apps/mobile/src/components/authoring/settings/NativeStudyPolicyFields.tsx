import { siblingBuryOptions } from "@recall/application";
import type { SchedulerPolicy } from "@recall/domain";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import { View } from "react-native";
export function NativeStudyPolicyFields({
  policy,
  disabled,
  onChange,
}: {
  readonly policy: SchedulerPolicy;
  readonly disabled: boolean;
  readonly onChange: (policy: SchedulerPolicy) => void;
}) {
  return (
    <View className="gap-3">
      <NativeTextField
        label="Daily new cards"
        keyboardType="number-pad"
        editable={!disabled}
        value={Number.isNaN(policy.dailyNewLimit) ? "" : String(policy.dailyNewLimit ?? 20)}
        onChangeText={(value) => {
          onChange({ ...policy, dailyNewLimit: value.trim() ? Number(value) : NaN });
        }}
      />
      <NativeTextField
        label="Daily returning cards (blank is unlimited)"
        keyboardType="number-pad"
        editable={!disabled}
        value={policy.dailyReviewLimit === undefined ? "" : String(policy.dailyReviewLimit)}
        onChangeText={(value) => {
          onChange({ ...policy, dailyReviewLimit: value.trim() ? Number(value) : undefined });
        }}
      />
      <NativeTextField
        label="Flag after this many lapses"
        keyboardType="number-pad"
        editable={!disabled}
        value={Number.isNaN(policy.leechThreshold) ? "" : String(policy.leechThreshold ?? 8)}
        onChangeText={(value) => {
          onChange({ ...policy, leechThreshold: value.trim() ? Number(value) : NaN });
        }}
      />
      <NativeSelect
        label="Pause new cards while previous days’ reviews are overdue"
        value={String(policy.pauseNewWhenOverdue ?? true)}
        options={[
          { label: "Pause new cards", value: "true" },
          { label: "Keep introducing new cards", value: "false" },
        ]}
        disabled={disabled}
        onValueChange={(value) => {
          onChange({ ...policy, pauseNewWhenOverdue: value === "true" });
        }}
      />
      {siblingBuryOptions.map(({ field, label }) => (
        <NativeSelect
          key={field}
          label={label}
          value={String(policy[field] ?? policy.burySiblings ?? true)}
          options={[
            { label: "Bury until tomorrow", value: "true" },
            { label: "Show today", value: "false" },
          ]}
          disabled={disabled}
          onValueChange={(value) => {
            onChange({ ...policy, [field]: value === "true" });
          }}
        />
      ))}
    </View>
  );
}
