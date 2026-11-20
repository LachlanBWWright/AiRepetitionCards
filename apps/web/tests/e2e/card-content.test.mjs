import assert from "node:assert/strict";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";

test("equation editor previews, validates and inserts at the selection", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("authoring-card-content--default"));
    const source = page.getByRole("textbox", { name: "Card text", exact: true });
    await expectVisible(source);
    await source.focus();
    await source.evaluate((element) => {
      element.setSelectionRange(4, 5);
    });
    await page.getByRole("button", { name: "Equation", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Equation editor", exact: true });
    await expectVisible(editor);
    const equation = editor.getByRole("textbox", { name: "TeX equation", exact: true });
    assert.equal(await equation.inputValue(), "x");
    await equation.fill("\\frac{");
    await expectVisible(editor.getByRole("alert").filter({ hasText: "Equation:" }));
    assert.equal(
      await editor.getByRole("button", { name: "Insert equation", exact: true }).isDisabled(),
      true,
    );
    await editor.getByRole("button", { name: "Fraction", exact: true }).click();
    await expectVisible(editor.getByRole("status").filter({ hasText: "ready to insert" }));
    await editor.getByRole("button", { name: "Insert equation", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    assert.equal(await source.inputValue(), "Use \\(\\frac{a}{b}\\) here.");
    await page.getByRole("button", { name: "Equation", exact: true }).click();
    await editor.getByRole("combobox", { name: "Equation layout", exact: true }).click();
    await page.getByRole("option", { name: "Display · on its own line", exact: true }).click();
    await equation.fill("x^2");
    await editor.getByRole("button", { name: "Insert equation", exact: true }).click();
    assert.ok((await source.inputValue()).includes("\\[\nx^2\n\\]"));
  });
});

test("explanations are hidden before reveal and expandable afterward on narrow screens", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("authoring-card-content--default"));
      const explanation = page.getByRole("button", {
        name: "Explanation and supporting material",
        exact: true,
      });
      await expectVisible(page.getByRole("button", { name: /^Show answer/ }));
      assert.equal(await explanation.count(), 0);
      await page.getByRole("button", { name: /^Show answer/ }).click();
      await expectVisible(explanation);
      assert.equal(await explanation.getAttribute("aria-expanded"), "false");
      await explanation.click();
      await expectVisible(
        page.getByText("Energy equals mass times the speed of light squared.", { exact: true }),
      );
      await expectVisible(
        page.locator("pre code").filter({ hasText: "let energy = mass * c.powi(2);" }),
      );
      assert.equal(await explanation.getAttribute("aria-expanded"), "true");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    },
    { viewport: { width: 390, height: 844 } },
  );
});
