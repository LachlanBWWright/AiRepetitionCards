import assert from "node:assert/strict";
import { test, expectVisible, storyUrl, withBrowser } from "./helpers.mjs";

for (const width of [390, 1440]) {
  test(`insights disclosures preserve hierarchy and keyboard access at ${width}px`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl("knowledge-detailed-study-statistics--default"));
        const memory = page.getByRole("button", { name: /^Memory and study/ });
        await expectVisible(memory);
        assert.equal(await memory.getAttribute("aria-expanded"), "false");
        await memory.focus();
        await memory.press("Enter");
        await expectVisible(page.getByText("Cards remembered", { exact: true }));
        const distributions = page.getByRole("button", { name: /^Card distributions/ });
        await distributions.click();
        await expectVisible(page.getByRole("heading", { name: "Memory stability", exact: true }));
        assert.equal(await memory.getAttribute("aria-expanded"), "true");
        const values = page.getByRole("button", {
          name: "Review activity: show data table",
          exact: true,
        });
        await values.click();
        const table = page.getByRole("table", { name: "Review activity values" });
        await expectVisible(table);
        await expectVisible(table.getByRole("columnheader", { name: "Date", exact: true }));
        await expectVisible(table.getByRole("columnheader", { name: "Reviews", exact: true }));
        const parentBox = await memory.boundingBox();
        const metricBox = await page.getByText("Cards remembered", { exact: true }).boundingBox();
        assert.ok(parentBox && metricBox && Math.abs(metricBox.x - parentBox.x - 20) <= 2);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true,
        );
        await memory.click();
        assert.equal(await memory.getAttribute("aria-expanded"), "false");
        assert.equal(await distributions.getAttribute("aria-expanded"), "true");
        const simulator = page.getByRole("button", { name: /^Workload simulator/ });
        await simulator.click();
        await expectVisible(page.getByRole("button", { name: "Simulate workload", exact: true }));
      },
      { viewport: { width, height: 900 } },
    );
  });
}
