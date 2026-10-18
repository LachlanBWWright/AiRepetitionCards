import assert from "node:assert/strict";
import { test, expectVisible, withBrowser, storyUrl } from "./helpers.mjs";

test("web card editor resets duplicate consent when the answer changes", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-recall-dashboard--add-card-with-media"));
    const dialog = page.getByRole("dialog", { name: "Add card", exact: true });
    await expectVisible(dialog);
    await dialog
      .getByLabel("Question", { exact: true })
      .fill("What is the main role of mitochondria?");
    await dialog.getByLabel("Answer", { exact: true }).fill("ATP.");
    const consent = dialog.getByRole("checkbox", { name: "Keep both cards", exact: true });
    await expectVisible(consent);
    await consent.check();
    assert.equal(await consent.isChecked(), true);
    await dialog.getByLabel("Answer", { exact: true }).fill("ATP powers cellular processes.");
    assert.equal(await consent.isChecked(), false);
    assert.equal(
      await dialog.getByRole("button", { name: "Save and add another", exact: true }).isDisabled(),
      true,
    );
  });
});

test("changing a publication license resets permission confirmation", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-deck-sharing--publish-unknown-rights"));
    const license = page.getByRole("combobox", { name: "License", exact: true });
    await expectVisible(license);
    await license.click();
    await page.getByRole("option", { name: "CC BY 4.0", exact: true }).click();
    const permission = page.getByRole("checkbox", {
      name: /I own this content or have permission/,
    });
    await expectVisible(permission);
    await permission.check();
    assert.equal(await permission.isChecked(), true);
    await license.click();
    await page.getByRole("option", { name: "CC0 1.0", exact: true }).click();
    assert.equal(await permission.isChecked(), false);
    assert.equal(
      await page.getByRole("button", { name: "Publish area", exact: true }).isDisabled(),
      true,
    );
  });
});

test("sharing search clears the complete filter value without losing results", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-deck-sharing--discover"));
    const search = page.getByRole("textbox", { name: "Search decks", exact: true });
    const language = page.getByRole("textbox", { name: "Filter by language", exact: true });
    const tag = page.getByRole("textbox", { name: "Filter by tag", exact: true });
    await expectVisible(search);
    await search.fill("cells");
    await language.fill("en");
    await tag.fill("biology");
    await page.getByRole("combobox", { name: "Difficulty", exact: true }).click();
    await page.getByRole("option", { name: "Beginner", exact: true }).click();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    assert.equal(await search.inputValue(), "");
    assert.equal(await language.inputValue(), "");
    assert.equal(await tag.inputValue(), "");
    assert.match(
      await page.getByRole("combobox", { name: "Difficulty", exact: true }).innerText(),
      /Any difficulty/,
    );
    await expectVisible(page.getByText("Cell biology foundations", { exact: true }));
  });
});
