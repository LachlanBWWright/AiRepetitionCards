import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyReminderApi } from "../../../../apps/web/src/lib/daily-reminder-api";
import {
  day,
  disabled,
  enabled,
  failure,
  fixture,
  key,
  success,
} from "./browser-reminders-support.js";

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
