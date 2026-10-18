import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dailyReminderApi,
  startDailyReminderRuntime,
} from "../../../../apps/web/src/lib/daily-reminder-api";
import {
  day,
  disabled,
  enabled,
  failure,
  fixture,
  success,
  flush,
} from "./browser-reminders-support.js";

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
