import assert from "node:assert/strict";
import { test, expectVisible, storyUrl, withBrowser } from "./helpers.mjs";

test("collapsed navigation has aligned icons, full accessible names and no clipped text", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-recall-dashboard--collapsed-sidebar"));
    const sidebar = page.locator('aside[data-slot="sidebar"]');
    await expectVisible(page.locator('aside[data-slot="sidebar"][data-state="collapsed"]'));
    await page.waitForFunction(
      () =>
        Math.abs(
          document.querySelector('aside[data-slot="sidebar"]').getBoundingClientRect().width - 64,
        ) <= 1,
    );
    const rail = await sidebar.boundingBox();
    assert.ok(rail);
    assert.ok(Math.abs(rail.width - 64) <= 1);
    const names = ["Recall home", "Home", "Cell biology", "Account", "Sync status"];
    for (const name of names) {
      const button = sidebar.getByRole("button", { name, exact: true });
      await expectVisible(button);
      const bounds = await button.boundingBox();
      assert.ok(bounds);
      assert.ok(bounds.width >= 32 && bounds.height >= 32, name);
      assert.ok(Math.abs(bounds.x + bounds.width / 2 - (rail.x + rail.width / 2)) <= 1, name);
      assert.ok(bounds.x >= rail.x && bounds.x + bounds.width <= rail.x + rail.width, name);
    }
    assert.equal(await sidebar.locator('[data-slot="sidebar-footer"]').innerText(), "");
    const home = sidebar.getByRole("button", { name: "Home", exact: true });
    assert.equal(await home.innerText(), "");
    const subject = sidebar.getByRole("button", { name: "Cell biology", exact: true });
    assert.equal(await subject.innerText(), "C");
    await subject.hover();
    await expectVisible(page.getByRole("tooltip", { name: "Cell biology", exact: true }));
    await sidebar.getByRole("button", { name: "Account", exact: true }).click();
    await expectVisible(page.getByRole("menuitem", { name: "Account settings", exact: true }));
    await page.keyboard.press("Escape");
    await sidebar.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expectVisible(page.locator('aside[data-state="expanded"]'));
    await expectVisible(home.getByText("Home", { exact: true }));
  });
});

test("mobile navigation opens as a full-width menu after desktop collapse", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-recall-dashboard--collapsed-sidebar"));
    await expectVisible(page.locator('aside[data-state="collapsed"]'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Application navigation", exact: true });
    await expectVisible(menu);
    const home = menu.getByRole("button", { name: "Home", exact: true });
    assert.match(await home.innerText(), /Home/);
    await home.click();
    await menu.waitFor({ state: "hidden" });
  });
});
