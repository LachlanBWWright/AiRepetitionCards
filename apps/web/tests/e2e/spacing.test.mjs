import assert from "node:assert/strict";
import { test, expectVisible, storyUrl, withBrowser } from "./helpers.mjs";

const closeTo = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) <= 1, `Expected ${expected}px, received ${actual}px`);

for (const width of [390, 1440]) {
  test(`subject home uses consistent section gaps and aligned actions at ${width}px`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl("screens-recall-dashboard--today-desktop"));
        await expectVisible(page.getByRole("heading", { name: "Your subjects", exact: true }));
        const sections = await page.locator("main:has(> header h1)").evaluate((main) => {
          const visible = [...main.children].filter(
            (child) => child.getBoundingClientRect().height > 0,
          );
          return visible
            .slice(1)
            .map(
              (child, index) =>
                child.getBoundingClientRect().top - visible[index].getBoundingClientRect().bottom,
            );
        });
        assert.ok(sections.length >= 3);
        for (const gap of sections) closeTo(gap, 24);
        const filters = page.getByRole("region", { name: "Subject filters" });
        const search = await filters.getByRole("searchbox").boundingBox();
        const sort = await filters.getByRole("combobox").boundingBox();
        assert.ok(search && sort);
        closeTo(search.height, 40);
        closeTo(sort.height, 40);
        if (width < 640) {
          assert.ok(search.width >= 100 && sort.width >= 100);
          closeTo(search.y, sort.y);
          const actions = page.getByLabel("Activities for Cell biology", { exact: true });
          const boxes = await actions
            .locator("button, a")
            .evaluateAll((buttons) =>
              buttons.map((button) => button.getBoundingClientRect().width),
            );
          assert.equal(boxes.length, 1);
          closeTo(Math.max(...boxes), Math.min(...boxes));
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      },
      { viewport: { width, height: 1000 } },
    );
  });

  test(`budget fields retain 8px label gaps, 16px groups and matching widths at ${width}px`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl("screens-ai-budget-settings--usage"));
        const panel = page.getByRole("region", { name: "AI budget settings" });
        await expectVisible(panel.getByRole("textbox", { name: "Daily requests", exact: true }));
        const fields = await panel.locator("label:has(input)").evaluateAll((labels) =>
          labels.map((label) => {
            const input = label.querySelector("input");
            const bounds = label.getBoundingClientRect();
            const control = input?.getBoundingClientRect();
            return {
              gap: Number.parseFloat(getComputedStyle(label).rowGap),
              top: bounds.top,
              bottom: bounds.bottom,
              width: control?.width,
              height: control?.height,
            };
          }),
        );
        assert.equal(fields.length, 3);
        for (const [index, field] of fields.entries()) {
          closeTo(field.gap, 8);
          closeTo(field.height, 40);
          closeTo(field.width, fields[0].width);
          if (index > 0) closeTo(field.top - fields[index - 1].bottom, 16);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      },
      { viewport: { width, height: 1000 } },
    );
  });

  test(`backup sections have 24px separation and matching actions at ${width}px`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl("screens-workspace-backup-dialog--backup"));
        const dialog = page.getByRole("dialog", { name: "Workspace backup", exact: true });
        await expectVisible(dialog);
        const save = await dialog.getByRole("region", { name: "Save a backup" }).boundingBox();
        const restore = await dialog
          .getByRole("region", { name: "Restore a backup" })
          .boundingBox();
        const saveAction = await dialog
          .getByRole("button", { name: "Save workspace backup", exact: true })
          .boundingBox();
        const restoreAction = await dialog
          .getByRole("button", { name: "Restore backup", exact: true })
          .boundingBox();
        assert.ok(save && restore && saveAction && restoreAction);
        closeTo(restore.y - save.y - save.height, 24);
        closeTo(saveAction.width, restoreAction.width);
        closeTo(saveAction.height, 40);
        closeTo(restoreAction.height, 40);
      },
      { viewport: { width, height: 1000 } },
    );
  });
}

test("subject home navigation is a text link with a real destination", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-recall-dashboard--library-deck-detail"));
    const back = page.getByRole("link", { name: "Subjects", exact: true });
    await expectVisible(back);
    assert.equal(await back.getAttribute("href"), "/subjects");
    const style = await back.evaluate((link) => ({
      background: getComputedStyle(link).backgroundColor,
      decoration: getComputedStyle(link).textDecorationLine,
    }));
    assert.equal(style.background, "rgba(0, 0, 0, 0)");
    assert.match(style.decoration, /underline/);
    await back.click();
    await expectVisible(page.getByRole("heading", { name: "Your subjects", exact: true }));
  });
});
