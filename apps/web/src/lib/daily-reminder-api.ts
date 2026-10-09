import { Effect, Either, Schema } from "effect";
import { volatileStorage } from "@/lib/volatile-storage";
import {
  DailyReminderSettingsSchema,
  defaultDailyReminderSettings,
  type DailyReminderSettings,
} from "@recall/application";

export const DailyReminderSnapshotSchema = Schema.Struct({
  settings: DailyReminderSettingsSchema,
  supported: Schema.Boolean,
  lastDeliveredDay: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type DailyReminderSnapshot = typeof DailyReminderSnapshotSchema.Type;
export type DailyReminderFailure = {
  readonly _tag: "DailyReminderFailure";
  readonly message: string;
};
export type DailyReminderApi = {
  readonly read: () => Effect.Effect<DailyReminderSnapshot, DailyReminderFailure>;
  readonly set: (
    settings: DailyReminderSettings,
  ) => Effect.Effect<DailyReminderSnapshot, DailyReminderFailure>;
};
const failure = (message: string): DailyReminderFailure => ({
  _tag: "DailyReminderFailure",
  message,
});
const storageKey = "recall-daily-reminders";
const storedSchema = Schema.Struct({
  settings: DailyReminderSettingsSchema,
  lastDeliveredDay: Schema.NullOr(Schema.String),
});
const permissionError = () =>
  typeof Notification === "undefined"
    ? "Notifications are unavailable in this browser."
    : Notification.permission === "denied"
      ? "Notifications are blocked. Change this site's permission in browser settings."
      : Notification.permission !== "granted"
        ? "Notification permission has not been granted."
        : null;
function readBrowser() {
  return Effect.try({
    try: () => {
      const raw = volatileStorage.getItem(storageKey);
      const parsed =
        raw === null
          ? Either.right({ settings: defaultDailyReminderSettings, lastDeliveredDay: null })
          : Schema.decodeUnknownEither(storedSchema)(JSON.parse(raw) as unknown);
      return parsed;
    },
    catch: () => failure("Reminder settings could not be read from this device."),
  }).pipe(
    Effect.flatMap((parsed) =>
      Either.isRight(parsed)
        ? Effect.succeed({
            ...parsed.right,
            supported: typeof Notification !== "undefined",
            error: permissionError(),
          })
        : Effect.fail(
            failure("Saved reminder settings are invalid. Reset them by saving new settings."),
          ),
    ),
  );
}
function decodeDesktop(raw: unknown) {
  return Schema.decodeUnknown(
    Schema.Struct({ _tag: Schema.Literal("Success"), value: DailyReminderSnapshotSchema }),
  )(raw).pipe(
    Effect.map((response) => response.value),
    Effect.mapError(() => failure("Desktop reminder settings are unavailable.")),
  );
}
export const dailyReminderApi: DailyReminderApi = {
  read: () => {
    const bridge = window.recallDesktop?.reminders;
    return bridge
      ? Effect.tryPromise({
          try: () => bridge.read(),
          catch: () => failure("Desktop reminder settings could not be read."),
        }).pipe(Effect.flatMap(decodeDesktop))
      : readBrowser();
  },
  set: (settings) =>
    Schema.decodeUnknown(DailyReminderSettingsSchema)(settings).pipe(
      Effect.mapError(() => failure("Choose a valid reminder time.")),
      Effect.flatMap((validated) => {
        const bridge = window.recallDesktop?.reminders;
        if (bridge)
          return Effect.tryPromise({
            try: () => bridge.set(validated),
            catch: () => failure("Desktop reminder settings could not be saved."),
          }).pipe(Effect.flatMap(decodeDesktop));
        return Effect.gen(function* () {
          if (validated.enabled) {
            if (typeof Notification === "undefined")
              return yield* Effect.fail(failure("Notifications are unavailable in this browser."));
            const permission = yield* Effect.tryPromise({
              try: () => Notification.requestPermission(),
              catch: () => failure("Notification permission could not be requested."),
            });
            if (permission !== "granted")
              return yield* Effect.fail(
                failure(
                  "Notification permission was not granted. Enable notifications in browser settings, then save again.",
                ),
              );
          }
          const previous = yield* readBrowser().pipe(
            Effect.catchAll(() => Effect.succeed({ lastDeliveredDay: null })),
          );
          yield* Effect.try({
            try: () =>
              volatileStorage.setItem(
                storageKey,
                JSON.stringify({
                  settings: validated,
                  lastDeliveredDay: previous.lastDeliveredDay,
                }),
              ),
            catch: () => failure("Reminder settings could not be saved. Your edits are retained."),
          });
          window.dispatchEvent(new Event("recall-reminder-settings"));
          return yield* readBrowser();
        });
      }),
    ),
};
function localDay(now: Date) {
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function deliverBrowser(onOpen: () => void) {
  return Effect.gen(function* () {
    const snapshot = yield* readBrowser();
    const now = new Date();
    const day = localDay(now);
    if (
      !snapshot.settings.enabled ||
      permissionError() ||
      snapshot.lastDeliveredDay === day ||
      now.getHours() * 60 + now.getMinutes() <
        snapshot.settings.hour * 60 + snapshot.settings.minute
    )
      return;
    yield* Effect.tryPromise({
      try: async () => {
        const registration =
          "serviceWorker" in navigator
            ? await navigator.serviceWorker.getRegistration()
            : undefined;
        const options = {
          body: "Open Today for your daily spaced repetition session.",
          tag: "recall-daily-study",
          data: { kind: "daily-study-reminder" },
        };
        if (registration) await registration.showNotification("Time to study", options);
        else {
          const notification = new Notification("Time to study", options);
          notification.onclick = () => {
            notification.close();
            window.focus();
            onOpen();
          };
        }
      },
      catch: () => failure("The browser could not display a study reminder."),
    });
    const current = yield* readBrowser();
    yield* Effect.try({
      try: () =>
        volatileStorage.setItem(
          storageKey,
          JSON.stringify({ settings: current.settings, lastDeliveredDay: day }),
        ),
      catch: () => failure("The reminder was shown, but its delivery could not be saved."),
    });
  });
}
/** Browser reminders need an open page. Desktop scheduling is owned by the main process. */
export function startDailyReminderRuntime(onOpen: () => void): () => void {
  const bridge = window.recallDesktop?.reminders;
  if (bridge) return bridge.onOpen(onOpen);
  let running = false;
  let active = true;
  const check = () => {
    if (running || !active) return;
    running = true;
    const run = () => Effect.runPromise(Effect.either(deliverBrowser(onOpen)));
    const guarded =
      "locks" in navigator
        ? Effect.tryPromise({
            try: async () => {
              await navigator.locks.request("recall-daily-study", run);
            },
            catch: () => failure("Reminder coordination is unavailable."),
          })
        : Effect.promise(async () => {
            await run();
          });
    void Effect.runPromise(Effect.either(guarded)).finally(() => {
      running = false;
    });
  };
  const message = (event: MessageEvent<unknown>) => {
    const decoded = Schema.decodeUnknownEither(
      Schema.Struct({ type: Schema.Literal("recall-daily-reminder-open") }),
    )(event.data);
    if (Either.isRight(decoded)) onOpen();
  };
  const timer = window.setInterval(check, 30_000);
  window.addEventListener("focus", check);
  window.addEventListener("storage", check);
  window.addEventListener("recall-reminder-settings", check);
  document.addEventListener("visibilitychange", check);
  navigator.serviceWorker?.addEventListener("message", message);
  check();
  return () => {
    active = false;
    clearInterval(timer);
    window.removeEventListener("focus", check);
    window.removeEventListener("storage", check);
    window.removeEventListener("recall-reminder-settings", check);
    document.removeEventListener("visibilitychange", check);
    navigator.serviceWorker?.removeEventListener("message", message);
  };
}
