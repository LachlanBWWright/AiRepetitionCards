import {
  defaultReviewerSettings,
  type ReviewerSettings,
  type SchedulerSettings,
} from "@recall/domain";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import { Text, View } from "react-native";

export function NativeReviewerSettings({
  settings,
  disabled,
  onChange,
}: {
  readonly settings: SchedulerSettings;
  readonly disabled: boolean;
  readonly onChange: (settings: SchedulerSettings) => void;
}) {
  const reviewer = settings.reviewer ?? defaultReviewerSettings;
  const update = (patch: Partial<ReviewerSettings>) => {
    onChange({ ...settings, reviewer: { ...reviewer, ...patch } });
  };
  const actions = ["reveal", "again", "hard", "good", "easy"] as const;
  return (
    <View className="gap-3 border-t border-recall-line pt-4">
      <Text className="font-bold text-recall-ink">Reviewer controls</Text>
      <NativeSelect
        label="Elapsed time"
        value={String(reviewer.showTimer)}
        disabled={disabled}
        options={[
          { label: "Hidden", value: "false" },
          { label: "Show timer", value: "true" },
        ]}
        onValueChange={(value) => {
          update({ showTimer: value === "true" });
        }}
      />
      {(["questionSeconds", "answerSeconds"] as const).map((field) => (
        <NativeTextField
          key={field}
          label={
            field === "questionSeconds"
              ? "Reveal after (seconds, 0 disables)"
              : "Rate after (seconds, 0 disables)"
          }
          keyboardType="number-pad"
          editable={!disabled}
          value={Number.isNaN(reviewer[field]) ? "" : String(reviewer[field])}
          onChangeText={(value) => {
            update({ [field]: value.trim() ? Number(value) : NaN });
          }}
        />
      ))}
      <Text className="text-sm text-recall-muted">
        Start auto-advance in the reviewer. It pauses when you leave the screen.
      </Text>
      <NativeSelect
        label="Automatic rating"
        value={reviewer.answerAction}
        disabled={disabled}
        options={actions
          .filter((action) => action !== "reveal")
          .map((action) => ({ value: action, label: action }))}
        onValueChange={(value) => {
          if (value === "again" || value === "hard" || value === "good" || value === "easy")
            update({ answerAction: value });
        }}
      />
      <NativeSelect
        label="Swipe gestures"
        value={String(reviewer.swipeEnabled)}
        disabled={disabled}
        options={[
          { label: "Disabled", value: "false" },
          { label: "Enabled", value: "true" },
        ]}
        onValueChange={(value) => {
          update({ swipeEnabled: value === "true" });
        }}
      />
      {reviewer.swipeEnabled &&
        (["swipeLeft", "swipeRight"] as const).map((field) => (
          <NativeSelect
            key={field}
            label={field === "swipeLeft" ? "Swipe left" : "Swipe right"}
            value={reviewer[field]}
            disabled={disabled}
            options={actions.map((action) => ({
              value: action,
              label: action === "reveal" ? "Show answer" : action,
            }))}
            onValueChange={(value) => {
              if (
                value === "reveal" ||
                value === "again" ||
                value === "hard" ||
                value === "good" ||
                value === "easy"
              )
                update({ [field]: value });
            }}
          />
        ))}
      <Text className="text-sm text-recall-muted">
        Web and desktop keyboard shortcuts: distinct letters, numbers, or a space.
      </Text>
      {actions.map((action) => (
        <NativeTextField
          key={action}
          label={`${action} shortcut`}
          maxLength={1}
          editable={!disabled}
          value={reviewer.shortcuts[action]}
          onChangeText={(value) => {
            update({ shortcuts: { ...reviewer.shortcuts, [action]: value } });
          }}
        />
      ))}
    </View>
  );
}
