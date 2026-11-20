"use client";

import { Label } from "@recall/ui-web/components/label";
import { useEffect, useState } from "react";
import { Effect, Either } from "effect";
import { Button } from "@/components/ui/Button";
import { Alert, Input, toast } from "@recall/ui-web";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
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
      toast.success(
        result.right.settings.enabled ? "Daily reminder saved." : "Daily reminder disabled.",
      );
    } else setMessage(result.left.message);
  }
  return (
    <section className="flex w-full max-w-3xl flex-col gap-4" aria-label="Daily reminder settings">
      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-lg font-semibold">Daily reminder</h2>
        <p className="m-0 leading-relaxed text-muted-foreground">
          {desktop ? "Requires the app to be running." : "Requires this page to stay open."}
        </p>
      </div>
      <Label className="flex items-center gap-2" htmlFor="daily-reminder-enabled">
        <Checkbox
          id="daily-reminder-enabled"
          checked={settings.enabled}
          disabled={busy}
          onCheckedChange={(checked) => {
            setSettings({ ...settings, enabled: checked === true });
          }}
        />{" "}
        Enable daily reminder
      </Label>
      <Label className="grid w-full gap-2" htmlFor="daily-reminder-time-input">
        Reminder time
        <Input
          id="daily-reminder-time-input"
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
      </Label>
      <Collapsible>
        <CollapsibleTrigger>Notification permissions</CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2">
          <p className="m-0 max-w-[56ch] leading-relaxed text-muted-foreground">
            Enabling requests notification permission. Change blocked permissions in your browser or
            device settings.
          </p>
          <p className="m-0 max-w-[56ch] leading-relaxed text-muted-foreground">
            {desktop
              ? "Reminders can appear with the window minimized, but stop when you quit."
              : "Suspended pages may miss reminders. Reopening after the chosen time can show today's reminder."}
          </p>
          {snapshot?.lastDeliveredDay && <p>Last reminder: {snapshot.lastDeliveredDay}</p>}
        </CollapsibleContent>
      </Collapsible>
      {snapshot?.supported === false && (
        <Alert role="status">Notifications are unavailable on this device.</Alert>
      )}
      {snapshot?.error && <Alert variant="destructive">{snapshot.error}</Alert>}
      <Button
        className="w-full sm:w-auto sm:self-start"
        type="button"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Save reminder"}
      </Button>
      {message && <Alert variant="destructive">{message}</Alert>}
    </section>
  );
}
