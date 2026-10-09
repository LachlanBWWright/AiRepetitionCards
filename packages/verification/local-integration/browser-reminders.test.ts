import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Effect, Either } from "effect";
import {
  dailyReminderApi,
  startDailyReminderRuntime,
} from "../../../apps/web/src/lib/daily-reminder-api";

const key = "recall-daily-reminders";
const enabled = { enabled: true, hour: 19, minute: 0 };
const disabled = { ...enabled, enabled: false };
const day = "2026-10-05";
const flush = async () => {
  for (let step = 0; step < 8; step += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
};
function fixture(t: TestContext, permission: NotificationPermission = "granted") {
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
    setInterval: (callback: () => void) => {
      intervals.set(1, callback);
      return 1;
    },
    focus: () => {
      focus += 1;
    },
    recallDesktop: undefined,
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
async function success<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
async function failure<A, E extends { readonly _tag: string; readonly message: string }>(
  operation: Effect.Effect<A, E>,
  message: RegExp,
) {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left._tag, "DailyReminderFailure");
  assert.match(result.left.message, message);
}

void test("browser reads defaults without prompting or saving", async (t) => {
  const browser = fixture(t, "default");
  const result = await success(dailyReminderApi.read());
  assert.equal(result.settings.enabled, false);
  assert.equal(result.supported, true);
  assert.match(result.error ?? "", /not been granted/);
  assert.equal(browser.requests(), 0);
  assert.equal(browser.records.size, 0);
});

void test("unavailable and blocked browser permissions are reported; disabled saves never prompt", async (t) => {
  const browser = fixture(t, "denied");
  assert.match((await success(dailyReminderApi.read())).error ?? "", /blocked/);
  Reflect.deleteProperty(globalThis, "Notification");
  const unsupported = await success(dailyReminderApi.read());
  assert.equal(unsupported.supported, false);
  await failure(dailyReminderApi.set(enabled), /unavailable/);
  await success(dailyReminderApi.set(disabled));
  assert.equal(browser.requests(), 0);
});

void test("enabled saves require granted permission and denied requests do not overwrite", async (t) => {
  const browser = fixture(t, "default");
  browser.seed(disabled, day);
  const before = browser.records.get(key);
  browser.permissionResult("denied");
  await failure(dailyReminderApi.set(enabled), /not granted/);
  assert.equal(browser.records.get(key), before);
  browser.permissionResult("granted");
  const result = await success(dailyReminderApi.set(enabled));
  assert.equal(result.settings.enabled, true);
  assert.equal(result.lastDeliveredDay, day);
  assert.equal(browser.requests(), 2);
});

void test("rejected permission requests return typed failure without saving", async (t) => {
  const browser = fixture(t);
  browser.notification.requestPermission = () =>
    Promise.reject(new Error("Permission unavailable"));
  await failure(dailyReminderApi.set(enabled), /could not be requested/);
  assert.equal(browser.records.size, 0);
});

void test("invalid settings fail before requesting permission or changing storage", async (t) => {
  const browser = fixture(t);
  await failure(dailyReminderApi.set({ ...enabled, hour: 24 }), /valid reminder time/);
  assert.equal(browser.requests(), 0);
  assert.equal(browser.records.size, 0);
});

void test("corrupt JSON and invalid saved schemas fail safely and can be replaced", async (t) => {
  const browser = fixture(t);
  browser.records.set(key, "{");
  await failure(dailyReminderApi.read(), /could not be read/);
  browser.records.set(
    key,
    JSON.stringify({ settings: { ...disabled, minute: 60 }, lastDeliveredDay: null }),
  );
  await failure(dailyReminderApi.read(), /invalid/);
  const saved = await success(dailyReminderApi.set(disabled));
  assert.equal(saved.lastDeliveredDay, null);
  assert.deepEqual(saved.settings, disabled);
});

void test("storage access and write failures are classified", async (t) => {
  const browser = fixture(t);
  const read = Proxy.revocable(browser.storage.getItem, {});
  read.revoke();
  browser.storage.getItem = read.proxy;
  await failure(dailyReminderApi.read(), /could not be read/);
  browser.storage.getItem = (name) => browser.records.get(name) ?? null;
  const write = Proxy.revocable(browser.storage.setItem, {});
  write.revoke();
  browser.storage.setItem = write.proxy;
  await failure(dailyReminderApi.set(disabled), /could not be saved/);
  assert.equal(browser.records.size, 0);
});

void test("saving preserves the delivery day and emits one settings event", async (t) => {
  const browser = fixture(t);
  browser.seed(enabled, day);
  let events = 0;
  browser.browser.addEventListener("recall-reminder-settings", () => {
    events += 1;
  });
  const result = await success(dailyReminderApi.set({ enabled: false, hour: 23, minute: 59 }));
  assert.equal(result.lastDeliveredDay, day);
  assert.equal(events, 1);
});

void test("runtime does not prompt or deliver disabled or unpermitted reminders", async (t) => {
  const browser = fixture(t, "default");
  browser.seed();
  browser.start();
  await flush();
  assert.equal(browser.requests(), 0);
  assert.equal(browser.notifications.length, 0);
  browser.notification.permission = "granted";
  browser.seed(disabled);
  browser.browser.dispatchEvent(new Event("focus"));
  await flush();
  assert.equal(browser.notifications.length, 0);
});

void test("runtime waits until the configured minute then delivers once per local day", async (t) => {
  const browser = fixture(t);
  browser.seed({ ...enabled, minute: 1 });
  browser.start();
  await flush();
  assert.equal(browser.notifications.length, 0);
  t.mock.timers.setTime(new Date(`${day}T19:01:00Z`).getTime());
  browser.browser.dispatchEvent(new Event("focus"));
  await flush();
  assert.equal(browser.notifications.length, 1);
  assert.equal((await success(dailyReminderApi.read())).lastDeliveredDay, day);
  browser.intervals.get(1)?.();
  browser.documentEvents.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(browser.notifications.length, 1);
  t.mock.timers.setTime(new Date("2026-10-06T19:01:00Z").getTime());
  browser.browser.dispatchEvent(new Event("storage"));
  await flush();
  assert.equal(browser.notifications.length, 2);
});

void test("notification click closes, focuses, and opens Today", async (t) => {
  const browser = fixture(t);
  browser.seed();
  let opened = 0;
  browser.start(() => {
    opened += 1;
  });
  await flush();
  const notification = browser.notifications[0];
  assert.ok(notification);
  assert.equal(notification.title, "Time to study");
  assert.equal(notification.options.tag, "recall-daily-study");
  notification.onclick?.();
  assert.equal(notification.closed, true);
  assert.equal(browser.focus(), 1);
  assert.equal(opened, 1);
});

void test("service worker delivery prevents overlapping checks and preserves concurrent settings", async (t) => {
  const browser = fixture(t);
  browser.seed();
  let resolveDelivery: (() => void) | undefined;
  let deliveries = 0;
  browser.registration({
    showNotification: async () => {
      deliveries += 1;
      await new Promise<void>((resolve) => {
        resolveDelivery = resolve;
      });
    },
  });
  browser.start();
  await flush();
  browser.browser.dispatchEvent(new Event("focus"));
  browser.intervals.get(1)?.();
  await flush();
  assert.equal(deliveries, 1);
  browser.seed({ enabled: false, hour: 8, minute: 30 });
  resolveDelivery?.();
  await flush();
  const result = await success(dailyReminderApi.read());
  assert.deepEqual(result.settings, { enabled: false, hour: 8, minute: 30 });
  assert.equal(result.lastDeliveredDay, day);
  assert.equal(browser.notifications.length, 0);
});

void test("failed notification delivery stays retryable without recording delivery", async (t) => {
  const browser = fixture(t);
  browser.seed();
  browser.registration({ showNotification: () => Promise.reject(new Error("Unavailable")) });
  browser.start();
  await flush();
  assert.equal((await success(dailyReminderApi.read())).lastDeliveredDay, null);
  browser.registration(undefined);
  browser.browser.dispatchEvent(new Event("focus"));
  await flush();
  assert.equal(browser.notifications.length, 1);
});

void test("worker messages validate unknown data and runtime cleanup removes listeners and timer", async (t) => {
  const browser = fixture(t);
  browser.seed(disabled);
  let opened = 0;
  const stop = browser.start(() => {
    opened += 1;
  });
  await flush();
  for (const data of [null, [], "recall-daily-reminder-open", { type: "other" }, { type: 1 }]) {
    browser.workerEvents.dispatchEvent(new MessageEvent("message", { data }));
  }
  assert.equal(opened, 0);
  browser.workerEvents.dispatchEvent(
    new MessageEvent("message", { data: { type: "recall-daily-reminder-open" } }),
  );
  assert.equal(opened, 1);
  stop();
  assert.equal(browser.intervals.size, 0);
  browser.seed();
  browser.browser.dispatchEvent(new Event("focus"));
  browser.browser.dispatchEvent(new Event("storage"));
  browser.browser.dispatchEvent(new Event("recall-reminder-settings"));
  browser.documentEvents.dispatchEvent(new Event("visibilitychange"));
  browser.workerEvents.dispatchEvent(
    new MessageEvent("message", { data: { type: "recall-daily-reminder-open" } }),
  );
  await flush();
  assert.equal(opened, 1);
  assert.equal(browser.notifications.length, 0);
});

void test("desktop bridge validates responses and cleans up its subscription without browser scheduling", async (t) => {
  const browser = fixture(t);
  let opened: (() => void) | undefined;
  let disposed = 0;
  let response: unknown = {
    _tag: "Success",
    value: { settings: disabled, supported: true, lastDeliveredDay: null, error: null },
  };
  Reflect.set(browser.browser, "recallDesktop", {
    reminders: {
      read: () => Promise.resolve(response),
      set: () => Promise.resolve(response),
      onOpen: (callback: () => void) => {
        opened = callback;
        return () => {
          disposed += 1;
        };
      },
    },
  });
  assert.deepEqual((await success(dailyReminderApi.read())).settings, disabled);
  await success(dailyReminderApi.set(enabled));
  assert.equal(browser.requests(), 0);
  response = { _tag: "Success", value: { settings: enabled, supported: "yes" } };
  await failure(dailyReminderApi.read(), /unavailable/);
  response = { _tag: "Failure", message: "vendor error" };
  await failure(dailyReminderApi.set(disabled), /unavailable/);
  let count = 0;
  const stop = startDailyReminderRuntime(() => {
    count += 1;
  });
  opened?.();
  stop();
  assert.equal(count, 1);
  assert.equal(disposed, 1);
  assert.equal(browser.intervals.size, 0);
});

void test("Web Locks serializes multiple runtimes so shared storage delivers once", async (t) => {
  const browser = fixture(t);
  browser.seed();
  let tail = Promise.resolve();
  let requests = 0;
  Object.defineProperty(globalThis.navigator, "locks", {
    configurable: true,
    value: {
      request: async (name: string, callback: () => Promise<unknown>) => {
        assert.equal(name, "recall-daily-study");
        requests += 1;
        const previous = tail;
        let release: (() => void) | undefined;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback();
        } finally {
          release?.();
        }
      },
    },
  });
  browser.start();
  browser.start();
  await flush();
  assert.equal(requests, 2);
  assert.equal(browser.notifications.length, 1);
  assert.equal((await success(dailyReminderApi.read())).lastDeliveredDay, day);
});

void test("unavailable Web Locks do not display or mark a reminder delivered", async (t) => {
  const browser = fixture(t);
  browser.seed();
  Object.defineProperty(globalThis.navigator, "locks", {
    configurable: true,
    value: {
      request: () => Promise.reject(new Error("Coordination unavailable")),
    },
  });
  browser.start();
  await flush();
  assert.equal(browser.notifications.length, 0);
  assert.equal((await success(dailyReminderApi.read())).lastDeliveredDay, null);
});
