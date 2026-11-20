import assert from "node:assert/strict";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1024, height: 820 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
]) {
  test(`review layout stays within ${viewport.width}px and tools remain accessible`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl("review-study-layout--long-answer"));
        await expectVisible(page.getByRole("button", { name: "Study tools", exact: true }));
        assert.equal(
          await page.getByRole("button", { name: "Manage scheduling", exact: true }).count(),
          0,
        );
        const fits = () =>
          page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        assert.equal(await fits(), true, "Closed tools overflow the viewport");
        const trigger = await page
          .getByRole("button", { name: "Study tools", exact: true })
          .boundingBox();
        assert.ok(trigger && trigger.width <= 180, "Study tools trigger stretched");
        await page.getByRole("button", { name: "Study tools", exact: true }).click();
        await expectVisible(page.getByRole("button", { name: "Manage scheduling", exact: true }));
        assert.equal(await fits(), true, "Open tools overflow the viewport");
        await page.getByRole("button", { name: "Study tools", exact: true }).click();
        for (const rating of ["Again", "Hard", "Good", "Easy"])
          await expectVisible(page.getByRole("button", { name: new RegExp(`^${rating}`) }));
        await page.getByRole("button", { name: /^Good/ }).click();
        await expectVisible(page.getByText("Selected rating: good", { exact: true }));
        if (viewport.width === 1440)
          await page.screenshot({
            path: "../../artifacts/review-layout-desktop.png",
            fullPage: true,
          });
      },
      { viewport },
    );
  });
}

test("native review preserves four accessible ratings on a phone", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("review-study-layout--native"));
      for (const rating of ["Again", "Hard", "Good", "Easy"])
        await expectVisible(page.getByRole("button", { name: new RegExp(`^${rating}`) }));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      await page.getByRole("button", { name: /^Good/ }).click();
      await expectVisible(page.getByText("Selected rating: good", { exact: true }));
    },
    { viewport: { width: 390, height: 844 } },
  );
});
