import { NativeButton } from "@recall/ui-native";
import { NativeCollapsibleTrigger, NativeCollapsibleContent } from "@recall/ui-native";

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Effect, Either } from "effect";
import { parseLocalBudgetLimit, type LocalAiUsageSnapshot } from "@recall/application";
import { NativeTextField } from "../ui/NativeTextField";
import { nativeLocalBudget } from "../../storage/ai/native-local-ai-budget";

export function NativeBudgetSettingsPanel({ accountId }: { readonly accountId: string }) {
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [snapshot, setSnapshot] = useState<LocalAiUsageSnapshot | null>(null);
  const [fields, setFields] = useState<readonly string[]>(["", "", ""]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const publish = (value: LocalAiUsageSnapshot) => {
    setSnapshot(value);
    setFields(
      [
        value.policy.dailyRequestLimit,
        value.policy.weeklyRequestLimit,
        value.policy.dailyResearchLimit,
      ].map((limit) => (limit === null ? "" : String(limit))),
    );
  };
  useEffect(() => {
    let active = true;
    void Effect.runPromise(Effect.either(nativeLocalBudget.read(accountId))).then((result) => {
      if (!active) return;
      if (Either.isRight(result)) publish(result.right);
      else setMessage(result.left.message);
    });
    return () => {
      active = false;
    };
  }, [accountId]);
  async function refresh() {
    setBusy(true);
    const result = await Effect.runPromise(Effect.either(nativeLocalBudget.read(accountId)));
    setBusy(false);
    if (Either.isRight(result)) setSnapshot(result.right);
    else setMessage(result.left.message);
  }
  async function save() {
    const limits = fields.map(parseLocalBudgetLimit);
    if (limits.includes("invalid")) {
      setMessage("Choose whole limits from 0 to 1,000,000, or blank for unlimited.");
      return;
    }
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        nativeLocalBudget.setBudget({
          accountId,
          dailyRequestLimit: limits[0],
          weeklyRequestLimit: limits[1],
          dailyResearchLimit: limits[2],
        }),
      ),
    );
    setBusy(false);
    if (Either.isRight(result)) {
      publish(result.right);
      setMessage("Saved.");
    } else setMessage(result.left.message);
  }
  return (
    <View className="gap-4 p-4">
      <Text className="font-bold">AI usage limits</Text>
      <Text>Request limits for this account on this device. Leave blank for unlimited.</Text>
      <NativeButton
        label="Refresh usage"
        variant="default"
        disabled={busy}
        onPress={() => void refresh()}
      />
      {snapshot && (
        <>
          <Text>
            Today: {snapshot.summary.daily.requests} · Week: {snapshot.summary.weekly.requests}{" "}
            requests
          </Text>
          <NativeCollapsibleTrigger
            open={detailsVisible}
            title="Usage details and reset times"
            onToggle={() => {
              setDetailsVisible(!detailsVisible);
            }}
          />
          <NativeCollapsibleContent open={detailsVisible}>
            <View className="gap-2">
              <Text>
                {snapshot.summary.daily.completed} completed · {snapshot.summary.daily.failed}{" "}
                failed · {snapshot.summary.daily.pending} pending.
              </Text>
              <Text>
                Known tokens: {snapshot.summary.daily.inputTokens} input ·{" "}
                {snapshot.summary.daily.outputTokens} output. Usage unavailable for{" "}
                {snapshot.summary.daily.unknownUsageRequests} requests.
              </Text>
              <Text>
                Days reset at midnight UTC; weeks on Monday. Failed and pending requests count. A
                limit of 0 blocks requests.
              </Text>
              <Text>
                These limits do not show remaining ChatGPT allowance or set a spending cap.
              </Text>
            </View>
          </NativeCollapsibleContent>
          {["Daily requests", "Weekly requests", "Daily research requests"].map((label, index) => (
            <NativeTextField
              key={label}
              label={label}
              keyboardType="number-pad"
              editable={!busy}
              value={fields[index] ?? ""}
              placeholder="Unlimited"
              onChangeText={(text) => {
                setFields(fields.map((value, position) => (position === index ? text : value)));
              }}
            />
          ))}
          <NativeButton
            label={busy ? "Saving…" : "Save limits"}
            variant="default"
            disabled={busy}
            onPress={() => void save()}
          />
        </>
      )}
      {message && <Text accessibilityRole="alert">{message}</Text>}
    </View>
  );
}
