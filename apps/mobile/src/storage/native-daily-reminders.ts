import { Effect, Either, Schema } from "effect";
import * as SQLite from "expo-sqlite";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { DailyReminderSettingsSchema, defaultDailyReminderSettings } from "@recall/application";
export const NativeDailyReminderSettingsSchema = DailyReminderSettingsSchema;
export type NativeDailyReminderSettings = typeof NativeDailyReminderSettingsSchema.Type;
export const defaultNativeDailyReminderSettings = defaultDailyReminderSettings;
export type NativeDailyReminderFailure = {
  readonly _tag: "NativeDailyReminderFailure";
  readonly reason: "storage" | "invalid-settings" | "permission-denied" | "unavailable";
};
const fail = (reason: NativeDailyReminderFailure["reason"]): NativeDailyReminderFailure => ({
  _tag: "NativeDailyReminderFailure",
  reason,
});
const key = "daily-reminder:settings";
const channelId = "recall-daily-study";
const lane = Effect.runSync(Effect.makeSemaphore(1));
const vendor = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: () => fail("unavailable") });
const database = () =>
  Effect.tryPromise({
    try: async () => {
      const db = await SQLite.openDatabaseAsync("recall.db");
      await db.execAsync(`CREATE TABLE IF NOT EXISTS local_key_value (
      key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
      return db;
    },
    catch: () => fail("storage"),
  });
export const readNativeDailyReminderSettings = Effect.gen(function* () {
  const db = yield* database();
  const row = yield* Effect.tryPromise({
    try: () =>
      db.getFirstAsync<{ readonly value: string }>(
        "SELECT value FROM local_key_value WHERE key = ?",
        key,
      ),
    catch: () => fail("storage"),
  });
  if (!row) return defaultNativeDailyReminderSettings;
  return yield* Schema.decodeUnknown(Schema.parseJson(NativeDailyReminderSettingsSchema))(
    row.value,
  ).pipe(Effect.mapError(() => fail("invalid-settings")));
});
const persist = (settings: NativeDailyReminderSettings) =>
  Effect.gen(function* () {
    const db = yield* database();
    yield* Effect.tryPromise({
      try: () =>
        db.runAsync(
          `INSERT INTO local_key_value (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          key,
          JSON.stringify(settings),
          new Date().toISOString(),
        ),
      catch: () => fail("storage"),
    });
  });
export function isNativeDailyReminder(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "recallDailyReminder" in data &&
    data.recallDailyReminder === true
  );
}
const cancelOwned = Effect.gen(function* () {
  const requests = yield* vendor(() => Notifications.getAllScheduledNotificationsAsync());
  yield* Effect.forEach(
    requests.filter((request) => isNativeDailyReminder(request.content.data)),
    (request) => vendor(() => Notifications.cancelScheduledNotificationAsync(request.identifier)),
    { discard: true },
  );
});
const hasPermission = (permissions: Notifications.NotificationPermissionsStatus) =>
  Platform.OS === "ios"
    ? permissions.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
      permissions.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
      permissions.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL
    : permissions.granted;
const channel = Effect.gen(function* () {
  if (Platform.OS === "android")
    yield* vendor(() =>
      Notifications.setNotificationChannelAsync(channelId, {
        name: "Daily study reminders",
        importance: Notifications.AndroidImportance.DEFAULT,
      }),
    );
});
const schedule = (settings: NativeDailyReminderSettings) =>
  vendor(() =>
    Notifications.scheduleNotificationAsync({
      content: {
        title: "Time for a little study",
        body: "Open Today to review your cards and continue learning.",
        data: { recallDailyReminder: true },
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: settings.hour,
        minute: settings.minute,
        channelId,
      },
    }),
  );
/** The OS keeps daily schedules while the app is closed. Startup never requests permission. */
export const restoreNativeDailyReminder = lane.withPermits(1)(
  Effect.gen(function* () {
    yield* cancelOwned;
    const settings = yield* readNativeDailyReminderSettings;
    if (!settings.enabled) return settings;
    yield* channel;
    const permissions = yield* vendor(() => Notifications.getPermissionsAsync());
    if (!hasPermission(permissions)) {
      yield* persist({ ...settings, enabled: false });
      return yield* Effect.fail(fail("permission-denied"));
    }
    const scheduled = yield* Effect.either(schedule(settings));
    if (Either.isLeft(scheduled)) {
      yield* persist({ ...settings, enabled: false });
      return yield* Effect.fail(scheduled.left);
    }
    return settings;
  }),
);
/** Call only from an explicit user action. Disabled is durable before changing OS schedules. */
export function saveNativeDailyReminder(
  input: unknown,
): Effect.Effect<NativeDailyReminderSettings, NativeDailyReminderFailure> {
  return lane.withPermits(1)(
    Effect.gen(function* () {
      const settings = yield* Schema.decodeUnknown(NativeDailyReminderSettingsSchema)(input).pipe(
        Effect.mapError(() => fail("invalid-settings")),
      );
      yield* persist({ ...settings, enabled: false });
      yield* cancelOwned;
      if (!settings.enabled) return settings;
      yield* channel;
      const existing = yield* vendor(() => Notifications.getPermissionsAsync());
      const permissions = hasPermission(existing)
        ? existing
        : yield* vendor(() =>
            Notifications.requestPermissionsAsync({
              ios: { allowAlert: true, allowSound: true, allowBadge: false },
            }),
          );
      if (!hasPermission(permissions)) return yield* Effect.fail(fail("permission-denied"));
      yield* schedule(settings);
      const saved = yield* Effect.either(persist(settings));
      if (Either.isLeft(saved)) {
        yield* cancelOwned;
        return yield* Effect.fail(saved.left);
      }
      return settings;
    }),
  );
}
/** Devicewide erasure cancels only Recall daily schedules before resetting preferences. */
export const clearNativeDailyReminders = lane.withPermits(1)(
  Effect.gen(function* () {
    yield* persist(defaultNativeDailyReminderSettings);
    yield* cancelOwned;
    const db = yield* database();
    yield* Effect.tryPromise({
      try: () => db.runAsync("DELETE FROM local_key_value WHERE key = ?", key),
      catch: () => fail("storage"),
    });
  }),
);
export function installNativeDailyReminderResponses(
  onOpenToday: () => void,
): Effect.Effect<() => void, NativeDailyReminderFailure> {
  return Effect.try({
    try: () => {
      Notifications.setNotificationHandler({
        handleNotification: async (notification) => ({
          shouldShowBanner: isNativeDailyReminder(notification.request.content.data),
          shouldShowList: isNativeDailyReminder(notification.request.content.data),
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      const handle = (response: Notifications.NotificationResponse) => {
        if (isNativeDailyReminder(response.notification.request.content.data)) {
          onOpenToday();
          Effect.runSync(
            Effect.either(
              Effect.try({
                try: () => Notifications.clearLastNotificationResponse(),
                catch: () => fail("unavailable"),
              }),
            ),
          );
        }
      };
      const subscription = Notifications.addNotificationResponseReceivedListener(handle);
      const previous = Notifications.getLastNotificationResponse();
      if (previous) handle(previous);
      return () => subscription.remove();
    },
    catch: () => fail("unavailable"),
  });
}
