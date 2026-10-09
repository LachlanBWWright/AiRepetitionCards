import { NativeButton } from "./ui/NativeButton";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform, Pressable, Text, View } from "react-native";
import { Effect, Either } from "effect";
import { NativeTimePicker } from "@recall/ui-native";
import {
  defaultNativeDailyReminderSettings,
  installNativeDailyReminderResponses,
  readNativeDailyReminderSettings,
  restoreNativeDailyReminder,
  saveNativeDailyReminder,
  type NativeDailyReminderFailure,
} from "../storage/native-daily-reminders";

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
      setNotice(enabled ? "Reminder saved." : "Daily reminder disabled.");
    } else {
      setNotice(errorMessage(result.left));
      const stored = await Effect.runPromise(Effect.either(readNativeDailyReminderSettings));
      if (Either.isRight(stored)) setSettings(stored.right);
    }
    setBusy(false);
  }, []);
  const markCleared = useCallback(() => {
    setSettings(defaultNativeDailyReminderSettings);
    setNotice("Reminder disabled.");
  }, []);
  return { settings, ready, busy, notice, save, markCleared };
}
export function NativeDailyReminderSettingsPanel({
  controller,
}: {
  readonly controller: ReturnType<typeof useNativeDailyReminders>;
}) {
  const { settings, ready, busy, notice, save } = controller;
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [draftTime, setDraftTime] = useState<Date | null>(null);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const selectedTime = draftTime ?? new Date(2000, 0, 1, settings.hour, settings.minute);
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  const apply = async (enabled: boolean) => {
    setInputNotice(null);
    await save(
      enabled,
      enabled ? selectedTime.getHours() : settings.hour,
      enabled ? selectedTime.getMinutes() : settings.minute,
    );
    setTimePickerVisible(false);
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
    <View className={"p-[20px] gap-[12px]"}>
      <Text className={"text-[22px] font-bold text-recall-ink"}>Daily reminder</Text>
      <Text className={"text-recall-ink text-[14px] leading-[21px]"}>
        Remind me to study each day, even when the app is closed.
      </Text>
      <Text className={"text-recall-ink text-[14px] leading-[21px]"}>
        Status: {!ready ? "Loading…" : settings.enabled ? "Enabled" : "Disabled"}
      </Text>
      <NativeButton
        label={`Reminder time · ${selectedTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        tone="soft"
        disabled={!ready || busy}
        onPress={() => setTimePickerVisible(true)}
      />
      {timePickerVisible ? (
        <NativeTimePicker
          value={selectedTime}
          onValueChange={(time) => {
            setDraftTime(time);
            if (Platform.OS === "android") setTimePickerVisible(false);
          }}
          onDismiss={() => setTimePickerVisible(false)}
        />
      ) : null}
      <NativeButton
        label={busy ? "Saving…" : settings.enabled ? "Save reminder time" : "Enable daily reminder"}
        disabled={!ready || busy}
        onPress={() => void apply(true)}
      />
      {settings.enabled ? (
        <NativeButton
          label="Disable reminder"
          tone="soft"
          disabled={!ready || busy}
          onPress={() => void apply(false)}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        className={"py-[12px]"}
        onPress={() => setDetailsVisible(!detailsVisible)}
      >
        <Text>{detailsVisible ? "Hide notification details" : "Notification permissions"}</Text>
      </Pressable>
      {detailsVisible ? (
        <View className={"gap-[8px]"}>
          <Pressable
            accessibilityRole="button"
            className={"py-[12px]"}
            onPress={() => {
              void openSettings();
            }}
          >
            <Text>Open notification permissions</Text>
          </Pressable>
          <Text className={"text-recall-ink text-[14px] leading-[21px]"}>
            Uses your device’s current timezone. Focus modes, battery restrictions and Android alarm
            settings can delay delivery.
          </Text>
        </View>
      ) : null}
      {(inputNotice ?? notice) && (
        <Text
          accessibilityLiveRegion="polite"
          className={"text-recall-ink text-[14px] leading-[21px]"}
        >
          {inputNotice ?? notice}
        </Text>
      )}
    </View>
  );
}
