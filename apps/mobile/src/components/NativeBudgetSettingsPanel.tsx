import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Effect, Either } from "effect";
import { parseLocalBudgetLimit, type LocalAiUsageSnapshot } from "@recall/application";
import { nativeLocalBudget } from "../storage/native-local-ai-budget";

export function NativeBudgetSettingsPanel({ accountId }: { readonly accountId: string }) {
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
      setMessage("Limits saved; usage history retained.");
    } else setMessage(result.left.message);
  }
  return (
    <View style={{ gap: 10, padding: 14 }}>
      <Text style={{ fontWeight: "700" }}>AI budget settings</Text>
      <Text>
        Account limits on this device only; not your remaining ChatGPT balance or a monetary cap.
        Days reset at midnight UTC; weeks on Monday. Failed and pending requests count. Blank is
        unlimited; 0 blocks requests.
      </Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void refresh()}>
        <Text>Refresh usage</Text>
      </Pressable>
      {snapshot && (
        <>
          <Text>
            Today: {snapshot.summary.daily.requests} · Week: {snapshot.summary.weekly.requests}{" "}
            requests
          </Text>
          <Text>
            Completed: {snapshot.summary.daily.completed} · Failed: {snapshot.summary.daily.failed}{" "}
            · Pending: {snapshot.summary.daily.pending}
          </Text>
          <Text>
            Known tokens: {snapshot.summary.daily.inputTokens} input /{" "}
            {snapshot.summary.daily.outputTokens} output. Unknown usage:{" "}
            {snapshot.summary.daily.unknownUsageRequests} requests.
          </Text>
          {["Daily requests", "Weekly requests", "Daily research requests"].map((label, index) => (
            <View key={label}>
              <Text>{label}</Text>
              <TextInput
                accessibilityLabel={label}
                keyboardType="number-pad"
                editable={!busy}
                value={fields[index] ?? ""}
                placeholder="Unlimited"
                onChangeText={(text) => {
                  setFields(fields.map((value, position) => (position === index ? text : value)));
                }}
                style={{ minHeight: 44, borderWidth: 1, padding: 8 }}
              />
            </View>
          ))}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()}>
            <Text>{busy ? "Saving…" : "Save limits"}</Text>
          </Pressable>
        </>
      )}
      {message && <Text accessibilityRole="alert">{message}</Text>}
    </View>
  );
}
