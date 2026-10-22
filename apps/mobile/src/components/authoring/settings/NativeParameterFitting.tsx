import { useParameterFitting } from "@recall/react";
import { Text, View } from "react-native";
import type { SchedulerSettings, Workspace } from "@recall/domain";
import { NativeTextField, NativeSelect } from "@recall/ui-native";
import { NativeButton } from "../../ui/NativeButton";

export function NativeParameterFitting({
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
  const { proposal, setProposal, message, busy, fit, cancel } = useParameterFitting(
    workspace,
    settings,
  );
  return (
    <View className="gap-3 border-t border-recall-line pt-3">
      <Text className="font-bold text-recall-ink">Personalized scheduling</Text>
      <Text className="text-sm text-recall-muted">
        Experimental local fitting uses all available histories and checks held-out answers. No
        review history leaves this device.
      </Text>
      <NativeTextField
        label="Exclude answers before (UTC YYYY-MM-DD)"
        editable={!disabled && !busy}
        value={settings.optimizationReviewedAfter?.slice(0, 10) ?? ""}
        onChangeText={(value) => {
          onChange({
            ...settings,
            optimizationReviewedAfter: value ? `${value}T00:00:00.000Z` : undefined,
          });
          setProposal(null);
        }}
      />
      <NativeSelect
        label="When parameters change on save"
        disabled={disabled || busy}
        value={String(settings.rescheduleOnParameterChange ?? false)}
        options={[
          { label: "Keep due dates until next review", value: "false" },
          { label: "Recalculate reviewed cards’ due dates", value: "true" },
        ]}
        onValueChange={(value) => {
          onChange({ ...settings, rescheduleOnParameterChange: value === "true" });
        }}
      />
      <Text className="text-sm text-recall-muted">
        Earlier answers still establish memory state. Recalculation preserves memory state and
        answer history; new and learning cards keep their dates.
      </Text>
      <Text>
        {settings.weights ? "Personalized parameters selected" : "Default FSRS parameters selected"}
      </Text>
      <NativeButton
        label={busy ? "Fitting parameters…" : "Fit parameters to my reviews"}
        disabled={disabled || busy}
        tone="soft"
        onPress={fit}
      />
      {busy && <NativeButton label="Cancel fitting" tone="soft" onPress={cancel} />}
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
      {proposal && (
        <Text>
          {proposal.reviewsProcessed} reviews across {proposal.cardsProcessed} cards evaluated.
          Temporal holdout RMSE: {proposal.baselineRmse.toFixed(3)} →{" "}
          {proposal.fittedRmse.toFixed(3)}. Latest 20% of answers are excluded from fitting.
        </Text>
      )}
      {proposal && (
        <Text>
          Validation loss: {proposal.baselineLoss.toFixed(3)} → {proposal.fittedLoss.toFixed(3)} on{" "}
          {proposal.validationObservations} answers. Lower is better.
        </Text>
      )}
      {proposal?.improved ? (
        <NativeButton
          label="Use proposed parameters on save"
          disabled={disabled}
          tone="soft"
          onPress={() => {
            onChange({ ...settings, weights: proposal.weights });
            setProposal(null);
          }}
        />
      ) : proposal ? (
        <Text>No validated improvement found. Keep the current parameters.</Text>
      ) : null}
      {settings.weights && (
        <NativeButton
          label="Use default parameters on save"
          disabled={disabled || busy}
          tone="soft"
          onPress={() => {
            const defaults = { ...settings };
            delete defaults.weights;
            onChange(defaults);
          }}
        />
      )}
    </View>
  );
}
