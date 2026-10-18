import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { Effect, Either } from "effect";
import { startDailyReminderRuntime } from "../../../../apps/web/src/lib/daily-reminder-api";

export const key = "recall-daily-reminders";
export const enabled = { enabled: true, hour: 19, minute: 0 };
export const disabled = { ...enabled, enabled: false };
export const day = "2026-10-05";
export const flush = async () => {
  for (let step = 0; step < 8; step += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
};
export function fixture(t: TestContext, permission: NotificationPermission = "granted") {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(`${day}T19:00:00Z`).getTime() });
  const cleanup: (() => void)[] = [];
  const stops: (() => void)[] = [];
  t.after(() => {
    for (const stop of stops) stop();
    for (const restore of cleanup) restore();
  });
  const records = new Map<string, string>();
  const notifications: FakeNotification[] = [];
  const intervals = new Map<number, () => void>();
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  const workerEvents = new EventTarget();
  let requests = 0;
  let focus = 0;
  let permissionResult: NotificationPermission = permission;
  let registration:
    | { showNotification: (title: string, options: NotificationOptions) => Promise<void> }
    | undefined;
  class FakeNotification {
    static permission = permission;
    static requestPermission = () => {
      requests += 1;
      FakeNotification.permission = permissionResult;
      return Promise.resolve(permissionResult);
    };
    onclick: (() => void) | null = null;
    closed = false;
    constructor(
      readonly title: string,
      readonly options: NotificationOptions,
    ) {
      notifications.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  const storage = {
    getItem: (name: string) => records.get(name) ?? null,
    setItem: (name: string, value: string) => {
      records.set(name, value);
    },
  };
  const browser = Object.assign(windowEvents, {
    localStorage: storage,
    setInterval: (callback: () => void) => {
      intervals.set(1, callback);
      return 1;
    },
    focus: () => {
      focus += 1;
    },
    recallDesktop: {},
  });
  const navigatorPort = {
    serviceWorker: Object.assign(workerEvents, {
      getRegistration: () => Promise.resolve(registration),
    }),
  };
  const replacements: Readonly<Record<string, unknown>> = {
    window: browser,
    document: documentEvents,
    navigator: navigatorPort,
    localStorage: storage,
    Notification: FakeNotification,
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
  };
  for (const [name, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    cleanup.push(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return {
    records,
    notifications,
    intervals,
    browser,
    storage,
    workerEvents,
    documentEvents,
    notification: FakeNotification,
    requests: () => requests,
    focus: () => focus,
    permissionResult: (value: NotificationPermission) => {
      permissionResult = value;
    },
    registration: (value: typeof registration) => {
      registration = value;
    },
    seed: (settings = enabled, lastDeliveredDay: string | null = null) => {
      records.set(key, JSON.stringify({ settings, lastDeliveredDay }));
    },
    start: (onOpen: () => void = () => undefined) => {
      const stop = startDailyReminderRuntime(onOpen);
      stops.push(stop);
      return stop;
    },
  };
}
export async function success<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
export async function failure<A, E extends { readonly _tag: string; readonly message: string }>(
  operation: Effect.Effect<A, E>,
  message: RegExp,
) {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left._tag, "DailyReminderFailure");
  assert.match(result.left.message, message);
}
