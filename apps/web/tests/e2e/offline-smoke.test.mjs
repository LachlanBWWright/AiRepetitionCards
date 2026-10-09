import assert from "node:assert/strict";
import { appUrl, expectVisible, waitForWorkspace, test, withBrowser } from "./helpers.mjs";

test("production application loads without credentials and survives an offline reload", async (t) => {
  await withBrowser(t, async ({ page, context }) => {
    await page.goto(appUrl);
    await expectVisible(page.getByRole("heading", { name: "Today", exact: true }));
    await expectVisible(page.getByRole("navigation", { name: "Main navigation" }));
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, {
      timeout: 60_000,
    });
    await page.evaluate(() => localStorage.setItem("e2e-persistence-marker", "retained"));
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectVisible(page.getByRole("heading", { name: "Today", exact: true }));
    assert.equal(
      await page.evaluate(() => localStorage.getItem("e2e-persistence-marker")),
      "retained",
    );
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: /Library$/ })
      .click();
    await expectVisible(page.getByRole("heading", { name: "Library", exact: true }));
  });
});

test("fresh browser contexts do not inherit another user's device data", async (t) => {
  await withBrowser(t, async ({ page, browser }) => {
    await page.goto(appUrl);
    await expectVisible(page.getByRole("heading", { name: "Today", exact: true }));
    await page.evaluate(() => localStorage.setItem("e2e-private-marker", "private"));
    const original = await waitForWorkspace(page, (value) => value?.schemaVersion === 1);
    const originalIds = new Set(
      original.areas.flatMap((area) => area.cards.map((card) => card.id)),
    );
    const isolated = await browser.newContext();
    try {
      const secondPage = await isolated.newPage();
      await secondPage.goto(appUrl);
      await expectVisible(secondPage.getByRole("heading", { name: "Today", exact: true }));
      assert.equal(
        await secondPage.evaluate(() => localStorage.getItem("e2e-private-marker")),
        null,
      );
      const workspace = await waitForWorkspace(secondPage, (value) => value?.schemaVersion === 1);
      assert.equal(
        workspace.areas.flatMap((area) => area.cards).some((card) => originalIds.has(card.id)),
        false,
      );
    } finally {
      await isolated.close();
    }
  });
});
