"use client";
import { useEffect, useState } from "react";
import { Effect, Either } from "effect";
import { defaultDailyReminderSettings } from "@recall/application";
import {
  dailyReminderApi,
  type DailyReminderApi,
  type DailyReminderSnapshot,
} from "@/lib/daily-reminder-api";
export function DailyReminderSettingsPanel({
  api = dailyReminderApi,
  initialSnapshot,
  desktop = false,
}: {
  readonly api?: DailyReminderApi;
  readonly initialSnapshot?: DailyReminderSnapshot;
  readonly desktop?: boolean;
}) {
  const [settings, setSettings] = useState(
    initialSnapshot?.settings ?? defaultDailyReminderSettings,
  );
  const [snapshot, setSnapshot] = useState(initialSnapshot ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (initialSnapshot) return;
    let active = true;
    void Effect.runPromise(Effect.either(api.read())).then((result) => {
      if (!active) return;
      if (Either.isRight(result)) {
        setSnapshot(result.right);
        setSettings(result.right.settings);
      } else setMessage(result.left.message);
    });
    return () => {
      active = false;
    };
  }, [api, initialSnapshot]);
  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await Effect.runPromise(Effect.either(api.set(settings)));
    setBusy(false);
    if (Either.isRight(result)) {
      setSnapshot(result.right);
      setSettings(result.right.settings);
      setMessage(
        result.right.settings.enabled ? "Daily reminder saved." : "Daily reminder disabled.",
      );
    } else setMessage(result.left.message);
  }
  return (
    <section className="tutor-panel" aria-label="Daily reminder settings">
      <p className="eyebrow">THIS DEVICE · LOCAL TIME</p>
      <h2>Daily study reminder</h2>
      <p>
        A single daily reminder opens Today. It works offline and does not send study data to a
        server.
      </p>
      <p>
        {desktop
          ? "Desktop reminders work while the application is running, including when its window is minimized. Quitting the application stops reminders."
          : "Browser reminders work while this page is open. Closing the browser or suspending this page prevents delivery; reopening after your chosen time can show today's reminder."}
      </p>
      <label>
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
        />{" "}
        Enable daily reminder
      </label>
      <label>
        Reminder time{" "}
        <input
          type="time"
          required
          disabled={busy}
          value={`${String(settings.hour).padStart(2, "0")}:${String(settings.minute).padStart(2, "0")}`}
          onChange={(event) => {
            const [hour, minute] = event.target.value.split(":").map(Number);
            if (
              hour !== undefined &&
              minute !== undefined &&
              Number.isInteger(hour) &&
              Number.isInteger(minute)
            )
              setSettings({ ...settings, hour, minute });
          }}
        />
      </label>
      <p>
        Saving an enabled reminder requests notification permission. If notifications are blocked,
        change permission in your browser or operating system settings.
      </p>
      {snapshot?.supported === false && (
        <p role="status">Notifications are unavailable on this device.</p>
      )}
      {snapshot?.error && <p role="status">{snapshot.error}</p>}
      {snapshot?.lastDeliveredDay && <p>Last reminder: {snapshot.lastDeliveredDay}</p>}
      <button type="button" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save reminder settings"}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
