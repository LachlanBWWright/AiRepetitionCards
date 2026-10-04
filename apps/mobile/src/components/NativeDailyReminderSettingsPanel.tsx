import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Effect, Either } from "effect";
import { designTokens } from "@recall/design-tokens";
import {
  defaultNativeDailyReminderSettings,
  installNativeDailyReminderResponses,
  readNativeDailyReminderSettings,
  restoreNativeDailyReminder,
  saveNativeDailyReminder,
  type NativeDailyReminderFailure,
} from "../storage/native-daily-reminders";

const palette = designTokens.color;
function errorMessage(error: NativeDailyReminderFailure): string {
  switch (error.reason) {
    case "permission-denied":
      return "Notifications are blocked. Allow them in device settings, then enable the reminder again.";
    case "invalid-settings":
      return "Reminder settings are invalid. Choose a valid time and save them again.";
    case "storage":
      return "Could not save reminder settings on this device. Please retry.";
    case "unavailable":
      return "Could not update device notifications. Scheduling is not confirmed; please retry.";
  }
}
export function useNativeDailyReminders(onOpenToday: () => void) {
  const [settings, setSettings] = useState(defaultNativeDailyReminderSettings);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const result = await Effect.runPromise(Effect.either(restoreNativeDailyReminder));
      if (!mounted) return;
      if (Either.isRight(result)) setSettings(result.right);
      else {
        setNotice(errorMessage(result.left));
        const stored = await Effect.runPromise(Effect.either(readNativeDailyReminderSettings));
        if (mounted && Either.isRight(stored)) setSettings(stored.right);
      }
      if (mounted) {
        if (Either.isLeft(responses)) setNotice(errorMessage(responses.left));
        setReady(true);
      }
    };
    const responses = Effect.runSync(
      Effect.either(installNativeDailyReminderResponses(onOpenToday)),
    );
    void refresh();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      mounted = false;
      appState.remove();
      if (Either.isRight(responses)) responses.right();
    };
  }, [onOpenToday]);
  const save = useCallback(async (enabled: boolean, hour: number, minute: number) => {
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(saveNativeDailyReminder({ enabled, hour, minute })),
    );
    if (Either.isRight(result)) {
      setSettings(result.right);
      setNotice(enabled ? "Daily reminder scheduled on this device." : "Daily reminder disabled.");
    } else {
      setNotice(errorMessage(result.left));
      const stored = await Effect.runPromise(Effect.either(readNativeDailyReminderSettings));
      if (Either.isRight(stored)) setSettings(stored.right);
    }
    setBusy(false);
  }, []);
  const markCleared = useCallback(() => {
    setSettings(defaultNativeDailyReminderSettings);
    setNotice("Daily reminder disabled and preferences cleared.");
  }, []);
  return { settings, ready, busy, notice, save, markCleared };
}
export function NativeDailyReminderSettingsPanel({
  controller,
}: {
  readonly controller: ReturnType<typeof useNativeDailyReminders>;
}) {
  const { settings, ready, busy, notice, save } = controller;
  const [draft, setDraft] = useState<{ readonly hour: string; readonly minute: string } | null>(
    null,
  );
  const hour = draft?.hour ?? String(settings.hour).padStart(2, "0");
  const minute = draft?.minute ?? String(settings.minute).padStart(2, "0");
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  const apply = async (enabled: boolean) => {
    if (
      enabled &&
      (!/^\d{1,2}$/.test(hour) ||
        !/^\d{1,2}$/.test(minute) ||
        Number(hour) > 23 ||
        Number(minute) > 59)
    ) {
      setInputNotice("Use an hour from 00–23 and a minute from 00–59.");
      return;
    }
    setInputNotice(null);
    await save(
      enabled,
      enabled ? Number(hour) : settings.hour,
      enabled ? Number(minute) : settings.minute,
    );
  };
  const openSettings = async () => {
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => Linking.openSettings(),
          catch: () => ({ _tag: "OpenSettingsFailure" }) as const,
        }),
      ),
    );
    if (Either.isLeft(result))
      setInputNotice(
        "Could not open device settings. Open them manually to allow notifications for Recall.",
      );
  };
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Daily study reminder</Text>
      <Text style={styles.text}>
        One local reminder each day, even when the app is closed. Tap it to open Today. No server or
        sign-in required.
      </Text>
      <Text style={styles.text}>
        Status: {!ready ? "Loading…" : settings.enabled ? "Enabled" : "Disabled"}
      </Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Reminder hour, 24-hour clock"
          keyboardType="number-pad"
          maxLength={2}
          value={hour}
          onChangeText={(value) => setDraft({ hour: value, minute })}
          style={styles.input}
          editable={!busy && ready}
        />
        <Text style={styles.text}>:</Text>
        <TextInput
          accessibilityLabel="Reminder minute"
          keyboardType="number-pad"
          maxLength={2}
          value={minute}
          onChangeText={(value) => setDraft({ hour, minute: value })}
          style={styles.input}
          editable={!busy && ready}
        />
        <Text style={styles.text}>local time</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={!ready || busy}
        style={styles.button}
        onPress={() => {
          void apply(true);
        }}
      >
        <Text>
          {busy ? "Saving…" : settings.enabled ? "Save reminder time" : "Enable daily reminder"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={!ready || busy}
        style={styles.button}
        onPress={() => {
          void apply(false);
        }}
      >
        <Text>Disable reminder</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => {
          void openSettings();
        }}
      >
        <Text>Open notification permissions</Text>
      </Pressable>
      <Text style={styles.text}>
        Uses your device’s current timezone. Focus modes, battery restrictions and Android alarm
        settings can delay delivery.
      </Text>
      {(inputNotice ?? notice) && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {inputNotice ?? notice}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { padding: 20, gap: 12, backgroundColor: palette.surface, borderRadius: 20 },
  title: { fontSize: 22, fontWeight: "700", color: palette.ink },
  text: { color: palette.ink, fontSize: 14, lineHeight: 21 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    backgroundColor: palette.paper,
    color: palette.ink,
    padding: 12,
    borderRadius: 8,
    minWidth: 58,
  },
  button: { padding: 12, borderRadius: 10, backgroundColor: palette.green },
});
