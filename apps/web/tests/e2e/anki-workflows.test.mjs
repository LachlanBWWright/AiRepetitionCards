import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";
const interactions = "../../artifacts/anki-improvements/interactions";
await mkdir(interactions, { recursive: true });

test("phone subject exposes two short card questions in its first viewport", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-recall-dashboard--library-deck-detail"));
      const table = page.getByRole("table", { name: "Cards", exact: true });
      for (const name of [
        "What is the main role of mitochondria?",
        "Where does transcription happen in a eukaryotic cell?",
      ]) {
        const question = table.getByRole("button", { name, exact: true });
        await expectVisible(question);
        const bounds = await question.boundingBox();
        assert.ok(
          bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844,
          "Subject chrome must leave room for the study material",
        );
      }
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("Space reveals, then records Good; typing and open dialogs do not rate", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("review-anki-workflow-improvements--web"));
    await expectVisible(page.getByRole("button", { name: /^Show answer/ }));
    await page.getByRole("heading", { name: "Cell biology", exact: true }).click();
    await page.keyboard.press("Space");
    await expectVisible(page.getByRole("button", { name: /^Good/ }));
    await page.getByRole("button", { name: "Study tools", exact: true }).click();
    await page.getByRole("button", { name: "Manage scheduling", exact: true }).click();
    const management = page.getByRole("dialog", { name: "Study management", exact: true });
    await expectVisible(management);
    await management
      .getByRole("textbox", { name: "Search cards and notes", exact: true })
      .press("Space");
    await page.keyboard.press("Enter");
    await expectVisible(page.getByText("Saved answers: 0", { exact: true }));
    await page.keyboard.press("Escape");
    await page.getByRole("heading", { name: "Cell biology", exact: true }).click();
    await page.keyboard.press("Space");
    await expectVisible(page.getByText("Saved answers: 1", { exact: true }));
    await expectVisible(page.getByRole("button", { name: /^Show answer/ }));
  });
});

for (const renderer of ["web", "native"]) {
  test(`${renderer} manual burial removes a card without an answer and Unbury restores it`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl(`review-anki-workflow-improvements--${renderer}`));
        await page.getByRole("button", { name: "Study tools", exact: true }).click();
        await page.getByRole("button", { name: "Bury until tomorrow", exact: true }).click();
        await page.screenshot({ path: `${interactions}/burial-${renderer}.png`, fullPage: true });
        const action =
          renderer === "web"
            ? page.getByRole("menuitem", { name: "Bury this note and its cards", exact: true })
            : page.getByRole("button", { name: "Bury this note and its cards", exact: true });
        await action.click();
        await expectVisible(page.getByText("Saved answers: 0", { exact: true }));
        const unbury = page.getByRole("button", { name: "Unbury cards", exact: true });
        await expectVisible(unbury);
        assert.equal(await page.getByRole("button", { name: /^Show answer/ }).count(), 0);
        await unbury.click();
        await expectVisible(page.getByRole("button", { name: /^Show answer/ }));
        await expectVisible(page.getByText("Saved answers: 0", { exact: true }));
      },
      { viewport: { width: 390, height: 844 } },
    );
  });
}

test("Browse is directly available and keyboard commands never intercept search typing", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-recall-dashboard--library-deck-detail"));
      await expectVisible(page.getByRole("button", { name: "Browse cards", exact: true }));
      const search = page.getByRole("searchbox", { name: "Search cards", exact: true });
      await search.fill("b");
      assert.equal(await page.getByRole("dialog").count(), 0);
      await search.clear();
      await page.getByRole("heading", { name: "Cell biology", exact: true }).click();
      await page.keyboard.press("b");
      const browser = page.getByRole("dialog", { name: "Browse cards and notes", exact: true });
      await expectVisible(browser);
      await browser.getByRole("textbox", { name: "Search cards and notes", exact: true }).fill("a");
      assert.equal(await page.getByRole("dialog", { name: "Add card", exact: true }).count(), 0);
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "Cell biology", exact: true }).click();
      await page.keyboard.press("a");
      await expectVisible(page.getByRole("dialog", { name: "Add card", exact: true }));
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("native editing focuses the draft and retains edits through cancellation confirmation", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-workspace-authoring--new-card-draft"));
      const question = page.getByRole("textbox", { name: "Question", exact: true });
      await expectVisible(question);
      assert.equal(await page.getByRole("button", { name: "New subject", exact: true }).count(), 0);
      assert.equal(await page.getByText("All cards · 4", { exact: true }).isVisible(), false);
      await question.fill("A draft to keep");
      await page.getByRole("button", { name: "Cancel editing", exact: true }).click();
      await expectVisible(page.getByRole("button", { name: "Continue editing", exact: true }));
      await page.getByRole("button", { name: "Continue editing", exact: true }).click();
      assert.equal(await question.inputValue(), "A draft to keep");
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("native tutor proposal is visibly editable without unrelated start controls", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-ai-tutor--proposal-approval"));
      await page.getByRole("button", { name: "Ask the tutor", exact: true }).click();
      await expectVisible(
        page.getByText("Not saved. Edit the card before approving it.", { exact: true }),
      );
      const question = page.getByRole("textbox", { name: "Proposed card question", exact: true });
      await question.fill("An edited proposal");
      const style = await question.evaluate((element) => ({
        size: parseFloat(getComputedStyle(element).fontSize),
        border: parseFloat(getComputedStyle(element).borderTopWidth),
      }));
      assert.ok(style.size >= 16 && style.border >= 1);
      assert.equal(
        await page.getByRole("button", { name: "Start tutor practice", exact: true }).count(),
        0,
      );
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("web browser previews a result and returns from editing with its search intact", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-recall-dashboard--library-deck-detail"));
      await page.getByRole("button", { name: "Browse cards", exact: true }).click();
      const browser = page.getByRole("dialog", { name: "Browse cards and notes", exact: true });
      const search = browser.getByRole("textbox", { name: "Search cards and notes", exact: true });
      await search.fill("mitochondria");
      await browser
        .getByRole("button", { name: /^Inspect related cards:/ })
        .first()
        .click();
      await expectVisible(
        browser.getByRole("complementary", { name: "Selected card", exact: true }),
      );
      await page.screenshot({ path: `${interactions}/browser-web.png`, fullPage: true });
      await browser.getByRole("button", { name: "Edit selected card", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Edit card", exact: true });
      await expectVisible(editor);
      await editor
        .getByRole("textbox", { name: "Answer", exact: true })
        .fill("ATP made through cellular respiration.");
      await editor.getByRole("button", { name: "Save changes", exact: true }).click();
      await expectVisible(browser);
      assert.equal(await search.inputValue(), "mitochondria");
      await expectVisible(
        browser.getByText("ATP made through cellular respiration.", { exact: true }),
      );
    },
    { viewport: { width: 1440, height: 1000 } },
  );
});

test("native browser returns from editing without losing its query", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-workspace-authoring--card-library"));
      await page.getByRole("button", { name: "Browse cards", exact: true }).click();
      const search = page.getByRole("textbox", { name: "Search cards and notes", exact: true });
      await search.fill("mitochondria");
      await page
        .getByRole("button", { name: "Inspect related cards", exact: true })
        .first()
        .click();
      await page.screenshot({ path: `${interactions}/browser-native.png`, fullPage: true });
      await page.getByRole("button", { name: "Edit selected card", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Answer", exact: true })
        .fill("ATP made through cellular respiration.");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await page.getByRole("button", { name: "Back to search results", exact: true }).click();
      assert.equal(await search.inputValue(), "mitochondria");
    },
    { viewport: { width: 390, height: 844 } },
  );
});
