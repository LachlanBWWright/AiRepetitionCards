import assert from "node:assert/strict";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`card help separates context, options and response at ${viewport.width}px`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl("knowledge-review-assistance--dialog-preview"));
        const dialog = page.getByRole("dialog");
        await expectVisible(dialog);
        await expectVisible(dialog.getByText("Card you’re reviewing", { exact: true }));
        const choices = dialog.getByRole("region", { name: "Choose card help", exact: true });
        assert.equal(await choices.getByRole("button").count(), 4);
        for (const button of await choices.getByRole("button").all())
          assert.equal(await button.getAttribute("data-variant"), "secondary");
        const fits = () => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth);
        assert.equal(await fits(), true);
        const bounds = await dialog.boundingBox();
        assert.ok(bounds && bounds.width <= viewport.width - 24);
        await dialog.getByRole("button", { name: "Explain this", exact: true }).click();
        await expectVisible(dialog.getByRole("heading", { name: "Tutor response", exact: true }));
        await expectVisible(
          dialog.getByText(
            "Mitochondria supply ATP, while ribosomes assemble proteins from amino acids.",
            { exact: true },
          ),
        );
        assert.equal(await fits(), true);
        await page.screenshot({
          path: `../../artifacts/review-help-${viewport.width}.png`,
          fullPage: true,
        });
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        assert.equal(await page.getByRole("dialog").count(), 0);
      },
      { viewport },
    );
  });
}
