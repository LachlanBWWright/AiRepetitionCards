import assert from "node:assert/strict";
import { test, expectVisible, storyUrl, withBrowser } from "./helpers.mjs";

test("modal close icon is a ghost control and still dismisses with the keyboard", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-workspace-backup-dialog--backup"));
    const dialog = page.getByRole("dialog", { name: "Workspace backup", exact: true });
    await expectVisible(dialog);
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    assert.equal(await close.getAttribute("data-variant"), "ghost");
    assert.equal(
      await close.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    await close.focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "hidden" });
  });
});

test("usage indicator is ghost styled and opens the usage details", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("tutor-context-usage--measured"));
    const meter = page.getByRole("button", {
      name: "Context: 12,500 of 100,000 tokens in the last request",
      exact: true,
    });
    await expectVisible(meter);
    assert.equal(await meter.getAttribute("data-variant"), "ghost");
    assert.equal(
      await meter.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    await meter.click();
    await expectVisible(page.getByText("Context window", { exact: true }));
    await expectVisible(page.getByText("12,500", { exact: true }));
  });
});
