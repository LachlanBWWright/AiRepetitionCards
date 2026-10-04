import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain, Notification, powerMonitor, type IpcMainInvokeEvent } from "electron";
import { Effect, Either, Schema } from "effect";
import { DailyReminderSettingsSchema, defaultDailyReminderSettings } from "@recall/application";

const StateSchema = Schema.Struct({
  settings: DailyReminderSettingsSchema,
  lastDeliveredDay: Schema.NullOr(Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/))),
});
type State = typeof StateSchema.Type;
const defaultState: State = {
  settings: defaultDailyReminderSettings,
  lastDeliveredDay: null,
};
type Failure = { readonly _tag: "DailyReminderFailure" };
const unavailable = (): Failure => ({ _tag: "DailyReminderFailure" });

function localDay(now: Date): string {
  return [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Timers run only while Electron is open. Native delivery remains subject to OS settings. */
export function registerDailyReminders(
  trustedSender: (event: IpcMainInvokeEvent) => boolean,
  openStudy: () => void,
): { readonly clear: () => Promise<boolean> } {
  const path = join(app.getPath("userData"), "daily-reminders", "settings.json");
  let state: State = defaultState;
  let initialized = false;
  let error: string | null = null;
  let notification: Notification | null = null;
  let queue: Promise<void> = Promise.resolve();
  const read = (): Effect.Effect<State, Failure> =>
    Effect.gen(function* () {
      const raw = yield* Effect.tryPromise({
        try: () => readFile(path, "utf8"),
        catch: (cause) => cause,
      }).pipe(
        Effect.catchAll((cause) =>
          typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT"
            ? Effect.succeed(null)
            : Effect.fail(unavailable()),
        ),
      );
      if (raw === null) return defaultState;
      if (Buffer.byteLength(raw, "utf8") > 4096) return yield* Effect.fail(unavailable());
      const parsed = yield* Effect.try({ try: (): unknown => JSON.parse(raw), catch: unavailable });
      return yield* Schema.decodeUnknown(StateSchema)(parsed).pipe(Effect.mapError(unavailable));
    });
  const write = (next: State): Effect.Effect<void, Failure> => {
    const temp = `${path}.${randomUUID()}.tmp`;
    return Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await chmod(dirname(path), 0o700);
        const file = await open(temp, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify(next), "utf8");
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temp, path);
      },
      catch: unavailable,
    }).pipe(
      Effect.ensuring(
        Effect.tryPromise({ try: () => unlink(temp), catch: unavailable }).pipe(Effect.ignore),
      ),
    );
  };
  const initialize = Effect.gen(function* () {
    if (!initialized) {
      state = yield* read();
      initialized = true;
    }
  });
  const snapshot = () => ({
    settings: state.settings,
    lastDeliveredDay: state.lastDeliveredDay,
    supported: Notification.isSupported(),
    error,
  });
  const serialize = <A>(
    operation: Effect.Effect<A, Failure>,
  ): Promise<Either.Either<A, Failure>> => {
    const pending = queue.then(() => Effect.runPromise(Effect.either(operation)));
    queue = pending.then(() => undefined);
    return pending;
  };
  const reconcile = (): void => {
    void serialize(
      Effect.gen(function* () {
        yield* initialize;
        if (!state.settings.enabled || !Notification.isSupported()) return;
        const now = new Date();
        const day = localDay(now);
        const scheduled = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          state.settings.hour,
          state.settings.minute,
        );
        if (now < scheduled || (state.lastDeliveredDay !== null && day <= state.lastDeliveredDay))
          return;
        // Persist before showing, so a restart or repeated resume cannot send duplicates.
        const next = { ...state, lastDeliveredDay: day };
        yield* write(next);
        state = next;
        yield* Effect.try({
          try: () => {
            notification?.close();
            const nextNotification = new Notification({
              title: "Time to study",
              body: "Open Recall for your daily review.",
              silent: false,
            });
            notification = nextNotification;
            nextNotification.on("click", openStudy);
            nextNotification.on("failed", () => {
              error =
                "The operating system could not deliver the reminder. Check notification permissions and app signing.";
            });
            nextNotification.show();
          },
          catch: unavailable,
        });
      }),
    ).then((result) => {
      if (Either.isLeft(result)) error = "Daily reminders could not be read, saved, or delivered.";
    });
  };
  ipcMain.handle("reminders:read", async (event): Promise<unknown> => {
    if (!trustedSender(event)) return { _tag: "Failure" };
    const result = await serialize(initialize.pipe(Effect.map(snapshot)));
    return Either.isRight(result) ? { _tag: "Success", value: result.right } : { _tag: "Failure" };
  });
  ipcMain.handle("reminders:set", async (event, input: unknown): Promise<unknown> => {
    if (!trustedSender(event)) return { _tag: "Failure" };
    const decoded = Schema.decodeUnknownEither(DailyReminderSettingsSchema)(input);
    if (Either.isLeft(decoded)) return { _tag: "Failure" };
    const result = await serialize(
      Effect.gen(function* () {
        yield* initialize;
        if (decoded.right.enabled && !Notification.isSupported())
          return yield* Effect.fail(unavailable());
        const next: State = { ...state, settings: decoded.right };
        yield* write(next);
        state = next;
        error = null;
        if (!next.settings.enabled) notification?.close();
        return snapshot();
      }),
    );
    if (Either.isRight(result)) reconcile();
    return Either.isRight(result) ? { _tag: "Success", value: result.right } : { _tag: "Failure" };
  });
  const timer = setInterval(reconcile, 60_000);
  timer.unref();
  powerMonitor.on("resume", reconcile);
  powerMonitor.on("unlock-screen", reconcile);
  app.on("before-quit", () => {
    clearInterval(timer);
    powerMonitor.removeListener("resume", reconcile);
    powerMonitor.removeListener("unlock-screen", reconcile);
  });
  reconcile();
  return {
    clear: async () => {
      const result = await serialize(
        Effect.gen(function* () {
          // Privacy erase can replace a malformed settings file without loading it.
          yield* write(defaultState);
          state = defaultState;
          initialized = true;
          error = null;
          yield* Effect.try({
            try: () => {
              notification?.close();
              notification = null;
            },
            catch: unavailable,
          });
        }),
      );
      return Either.isRight(result);
    },
  };
}
