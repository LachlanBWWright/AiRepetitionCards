import assert from "node:assert/strict";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";

for (const width of [320, 390, 1440]) {
  test(`subject search and navigation lead into a docked tutor at ${width}px`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl("screens-recall-dashboard--explore"));
        const search = page.getByRole("searchbox", { name: "Find a subject", exact: true });
        await expectVisible(search);
        await search.fill("no-subject-matches-this");
        await expectVisible(
          page.getByRole("heading", { name: "No matching subjects", exact: true }),
        );
        await page.getByRole("button", { name: "Clear search", exact: true }).click();
        await expectVisible(page.getByRole("link", { name: "Cell biology", exact: true }));
        await page.getByRole("link", { name: "Cell biology", exact: true }).click();
        await page.getByRole("combobox", { name: "Subject activity", exact: true }).click();
        await page.getByRole("option", { name: "Tutor", exact: true }).click();
        const input = page.getByRole("textbox", { name: "Tutor message", exact: true });
        await expectVisible(input);
        const composer = await input.locator("xpath=ancestor::form").boundingBox();
        assert.ok(
          composer && composer.y + composer.height <= 844 && composer.y + composer.height >= 820,
          "Tutor composer must stay at the bottom of the viewport",
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
      },
      { viewport: { width, height: 844 } },
    );
  });
}

test("empty Home offers creation without unusable review or filtering controls", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-recall-dashboard--empty-library"));
      await expectVisible(
        page.getByRole("heading", { name: "Create your first subject", exact: true }),
      );
      assert.equal(
        await page.getByRole("button", { name: "Review all due", exact: true }).count(),
        0,
      );
      assert.equal(
        await page.getByRole("searchbox", { name: "Find a subject", exact: true }).count(),
        0,
      );
      const home = page.locator("main:has(> header h1)");
      const create = home.getByRole("button", { name: "New subject", exact: true });
      assert.equal(await create.count(), 1);
      await create.click();
      await expectVisible(page.getByRole("dialog"));
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("phone card library exposes its actions without sideways scrolling", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-recall-dashboard--library-deck-detail"));
      const table = page.getByRole("table", { name: "Cards", exact: true });
      await expectVisible(table);
      const tableBounds = await table.boundingBox();
      assert.ok(tableBounds && tableBounds.x >= 0 && tableBounds.x + tableBounds.width <= 320);
      await table
        .getByRole("button", { name: "What is the main role of mitochondria?", exact: true })
        .click();
      await expectVisible(table.getByText("Answer:", { exact: true }));
      await table
        .getByRole("button", {
          name: "Actions for card: What is the main role of mitochondria?",
          exact: true,
        })
        .click();
      await page.getByRole("menuitem", { name: "Edit card", exact: true }).click();
      await expectVisible(page.getByRole("dialog", { name: "Edit card", exact: true }));
    },
    { viewport: { width: 320, height: 844 } },
  );
});

test("native card selection and editing remain accessible in the quieter list", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-workspace-authoring--card-library"));
      const selection = page.getByRole("checkbox", {
        name: "Select card: What is the main role of mitochondria?",
        exact: true,
      });
      await expectVisible(selection);
      const colour = await selection.evaluate(
        (element) => getComputedStyle(element.firstElementChild).color,
      );
      assert.notEqual(
        colour,
        "rgb(0, 0, 0)",
        "Selection indicator must be readable on the dark surface",
      );
      await selection.click();
      await expectVisible(page.getByText("1 selected", { exact: true }));
      await page
        .getByRole("button", { name: "Edit What is the main role of mitochondria?", exact: true })
        .click();
      await expectVisible(page.getByRole("textbox", { name: "Question", exact: true }));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("native tutor renders inline code as rich text", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("tutor-conversation-layout--native"));
      await expectVisible(page.getByText("Option<usize>", { exact: true }));
      assert.equal((await page.locator("body").innerText()).includes("`Option<usize>`"), false);
      const send = await page
        .getByRole("button", { name: "Send message", exact: true })
        .boundingBox();
      assert.ok(send && send.width >= 48 && send.height >= 48);
    },
    { viewport: { width: 390, height: 844 } },
  );
});
