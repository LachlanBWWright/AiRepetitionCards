import assert from "node:assert/strict";
import { test, expectVisible, storyUrl, withBrowser } from "./helpers.mjs";

const closeTo = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) <= 1, `Expected ${expected}px, received ${actual}px`);

async function assertActionWidths(footer, width) {
  await expectVisible(footer);
  const bounds = await footer.boundingBox();
  assert.ok(bounds);
  const actions = await footer.locator(":scope > button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    }),
  );
  assert.ok(actions.length >= 2);
  for (const action of actions) {
    if (width < 640) {
      closeTo(action.x, bounds.x);
      closeTo(action.width, bounds.width);
    } else {
      assert.ok(action.width < bounds.width, "Desktop actions should fit their labels");
    }
  }
  if (width >= 640) {
    closeTo(actions.at(-1).x + actions.at(-1).width, bounds.x + bounds.width);
  }
}

for (const width of [320, 390, 1440]) {
  test(`modal actions and form columns use consistent widths at ${width}px`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        for (const id of [
          "screens-recall-dashboard--edit-learning-area",
          "screens-account--delete-confirmation",
          "screens-tutor-privacy--confirm-clear",
          "screens-anki-import--review-import",
        ]) {
          await page.goto(storyUrl(id));
          await assertActionWidths(page.locator('[data-slot="dialog-footer"]'), width);
        }

        await page.goto(storyUrl("screens-recall-dashboard--add-card-with-media"));
        await page.getByRole("button", { name: "Equation", exact: true }).first().click();
        await assertActionWidths(
          page
            .getByRole("dialog", { name: "Equation editor" })
            .locator('[data-slot="dialog-footer"]'),
          width,
        );

        await page.goto(storyUrl("screens-deck-sharing--publish-unknown-rights"));
        const attribution = page.getByRole("textbox", { name: "Attribution", exact: true });
        await expectVisible(attribution);
        const field = await attribution.boundingBox();
        assert.ok(field);
        for (const name of ["Visibility", "Difficulty", "License"]) {
          const control = await page.getByRole("combobox", { name, exact: true }).boundingBox();
          assert.ok(control);
          closeTo(control.x, field.x);
          closeTo(control.width, field.width);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      },
      { viewport: { width, height: 1000 } },
    );
  });

  test(`library filters share a row and stay within their column at ${width}px`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl("screens-recall-dashboard--library-deck-detail"));
        const search = page.getByRole("searchbox", { name: "Search cards", exact: true });
        await expectVisible(search);
        await expectVisible(page.getByRole("combobox", { name: "Learning objective" }));
        await expectVisible(page.getByRole("button", { name: "Card tools", exact: true }));
        const searchBounds = await search.boundingBox();
        const filter = await page
          .getByRole("combobox", { name: "Learning objective" })
          .boundingBox();
        const tools = await page
          .getByRole("button", { name: "Card tools", exact: true })
          .boundingBox();
        assert.ok(searchBounds && filter && tools);
        closeTo(filter.y, tools.y);
        closeTo(filter.x + filter.width + 12, tools.x);
        if (width < 1024) {
          closeTo(filter.x, searchBounds.x);
          closeTo(tools.x + tools.width, searchBounds.x + searchBounds.width);
        } else {
          closeTo(searchBounds.y, filter.y);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      },
      { viewport: { width, height: 1000 } },
    );
  });
}

test("long model options fit inside a 320px viewport", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-account-settings-dialog--long-labels"));
      await page.getByRole("combobox", { name: "Model", exact: true }).click();
      const list = page.getByRole("listbox");
      await expectVisible(list);
      const bounds = await list.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320);
      const dimensions = await page.getByRole("option").evaluate((element) => ({
        width: element.clientWidth,
        content: element.scrollWidth,
      }));
      assert.ok(dimensions.content <= dimensions.width, "Long option text should wrap");
    },
    { viewport: { width: 320, height: 1000 } },
  );
});

test("blue subject navigation links open the subject and respect locked workspaces", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-recall-dashboard--today-desktop"));
    const subject = page.getByRole("link", { name: "Cell biology", exact: true });
    await expectVisible(subject);
    assert.match(await subject.getAttribute("href"), /^\/subjects\?area=.+&mode=overview$/);
    await subject.click();
    await expectVisible(page.getByRole("heading", { name: "Cell biology", exact: true }));

    await page.goto(storyUrl("screens-recall-dashboard--review-save-recovery"));
    const locked = page.getByRole("link", { name: "Cell biology", exact: true });
    await expectVisible(locked);
    assert.equal(await locked.getAttribute("aria-disabled"), "true");
    assert.equal(await locked.getAttribute("href"), null);
    assert.equal(await locked.getAttribute("tabindex"), "-1");
  });
});
