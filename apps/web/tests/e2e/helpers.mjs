import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { chromium } from "playwright";

export { test };
export const appUrl = process.env.RECALL_E2E_URL ?? "http://127.0.0.1:4173";
export const storyUrl = (id) =>
  `${appUrl}/storybook/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`;
export const expectVisible = (locator) => locator.waitFor({ state: "visible", timeout: 10_000 });
const artifacts = resolve(process.env.RECALL_E2E_ARTIFACTS ?? "../../artifacts/e2e");

/** Every case starts with fresh cookies, IndexedDB, service workers and local storage. */
export async function withBrowser(t, run, options = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const page = await context.newPage();
  const diagnostics = [];
  const pageErrors = [];
  const forbiddenRequests = [];
  const targetOrigin = new URL(appUrl).origin;
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(30_000);
  const observePage = (observedPage) => {
    observedPage.on("pageerror", (error) => {
      pageErrors.push(error.message);
      diagnostics.push(error.message);
    });
    observedPage.on("console", (message) => {
      if (message.type() === "error") diagnostics.push(message.text());
    });
  };
  observePage(page);
  context.on("page", observePage);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (url.origin !== targetOrigin) {
        forbiddenRequests.push(url.origin + url.pathname);
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  let failed = false;
  try {
    await run({ page, context, browser });
    assert.deepEqual(pageErrors, [], "Browser application raised an unhandled error");
    assert.deepEqual(forbiddenRequests, [], "Local tests must not contact external services");
  } catch (error) {
    failed = true;
    const name = t.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 120);
    const directory = resolve(artifacts, name);
    await mkdir(directory, { recursive: true });
    await Promise.allSettled([
      page.screenshot({ path: resolve(directory, "failure.png"), fullPage: true }),
      context.tracing.stop({ path: resolve(directory, "trace.zip") }),
      writeFile(
        resolve(directory, "diagnostics.json"),
        JSON.stringify({ diagnostics, forbiddenRequests }, null, 2),
      ),
    ]);
    // Assertions and browser failures propagate unchanged to node:test.
    return Promise.reject(error);
  } finally {
    if (!failed) await context.tracing.stop();
    await context.close();
    await browser.close();
  }
}

export async function readWorkspace(page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === "recall-workspace")) return null;
    const raw = await new Promise((resolveValue) => {
      const request = indexedDB.open("recall-workspace", 1);
      request.onerror = () => resolveValue(null);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("snapshots", "readonly");
        const result = transaction.objectStore("snapshots").get("current");
        let raw = null;
        result.onsuccess = () => {
          raw = result.result;
        };
        transaction.oncomplete = () => {
          database.close();
          resolveValue(raw);
        };
        transaction.onerror = () => {
          database.close();
          resolveValue(null);
        };
      };
    });
    return typeof raw === "string" ? JSON.parse(raw) : null;
  });
}

/** Bounded polling reads the real committed snapshot, never in-memory React state. */
export async function waitForWorkspace(page, predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readWorkspace(page);
    if (predicate(latest)) return latest;
    await delay(50);
  }
  assert.fail(`Workspace predicate did not match within ${timeout}ms: ${JSON.stringify(latest)}`);
}
