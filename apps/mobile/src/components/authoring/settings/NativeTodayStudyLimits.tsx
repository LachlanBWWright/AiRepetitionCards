import type { AreaId, SchedulerSettings } from "@recall/domain";
import { useTodayStudyLimits } from "@recall/react";
import { NativeButton, NativeTextField } from "@recall/ui-native";
import { Text, View } from "react-native";
export function NativeTodayStudyLimits({
  settings,
  onChange,
  areaId,
  disabled = false,
}: {
  readonly settings: SchedulerSettings;
  readonly onChange: (settings: SchedulerSettings) => void;
  readonly areaId?: AreaId | undefined;
  readonly disabled?: boolean;
}) {
  const limits = useTodayStudyLimits(settings, onChange, Date.now, areaId);
  return (
    <View className="gap-2 border-t border-recall-line pt-3">
      <Text>Today only</Text>
      <NativeTextField
        label="New cards today (blank keeps usual limit)"
        keyboardType="number-pad"
        editable={!disabled}
        value={limits.newLimit}
        onChangeText={limits.setNewLimit}
      />
      <NativeTextField
        label="Returning cards today (blank keeps usual limit)"
        keyboardType="number-pad"
        editable={!disabled}
        value={limits.reviewLimit}
        onChangeText={limits.setReviewLimit}
      />
      <NativeButton
        label="Apply to settings draft"
        disabled={disabled || !limits.canApply}
        onPress={limits.apply}
      />
      <Text>
        Save settings to apply. Expires at local midnight on this device; other devices use the same
        expiry instant.
      </Text>
    </View>
  );
}
