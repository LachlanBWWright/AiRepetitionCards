import assert from "node:assert/strict";
import { test, expectVisible, storyUrl, withBrowser } from "./helpers.mjs";

const open = async (page, id) => {
  await page.goto(storyUrl(id));
  await page.locator("#storybook-root > *").first().waitFor();
};

test("card editor keeps its header and actions visible while fields scroll", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await open(page, "screens-recall-dashboard--add-card-with-media");
      const dialog = page.getByRole("dialog", { name: "Add card", exact: true });
      const save = dialog.getByRole("button", { name: "Save card", exact: true });
      await expectVisible(save);
      const bounds = await save.boundingBox();
      assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844);
      const question = dialog.getByRole("textbox", { name: "Question", exact: true });
      await question.fill("A question that survives equation editing");
      await dialog.getByRole("button", { name: "Equation", exact: true }).first().click();
      const equation = page.getByRole("dialog", { name: "Equation editor" });
      const source = equation.getByRole("textbox", { name: "TeX equation" });
      assert.equal(await source.getAttribute("aria-invalid"), "false");
      assert.equal(
        await equation.getByRole("button", { name: "Insert equation" }).isDisabled(),
        true,
      );
      await expectVisible(equation.getByText("Your equation preview will appear here."));
      await source.fill("x^2");
      await page.waitForFunction(() =>
        [...document.querySelectorAll("button")].some(
          (button) => button.textContent.trim() === "Insert equation" && !button.disabled,
        ),
      );
      await equation.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await question.inputValue(), "A question that survives equation editing");
      await dialog.getByRole("button", { name: "Tags, objectives and media", exact: true }).click();
      await dialog.getByRole("button", { name: "Record pronunciation" }).scrollIntoViewIfNeeded();
      const after = await save.boundingBox();
      assert.ok(after && Math.abs(after.y - bounds.y) <= 1);
      await expectVisible(dialog.getByRole("heading", { name: "Add card", exact: true }));
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("deletion names the subject and cancellation retains its content", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await open(page, "screens-recall-dashboard--library-deck-detail");
    await page.getByRole("button", { name: "Manage Cell biology" }).click();
    await page.getByRole("menuitem", { name: "Delete subject", exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    await expectVisible(confirmation.getByRole("heading", { name: "Delete “Cell biology”?" }));
    assert.equal(
      await confirmation
        .getByRole("button", { name: "Delete subject" })
        .getAttribute("data-variant"),
      "destructive",
    );
    await expectVisible(confirmation.getByText(/review history will be retained/));
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expectVisible(page.getByRole("heading", { name: "Cell biology", exact: true }));
    await expectVisible(page.getByRole("searchbox", { name: "Search cards" }));
  });
});

test("publishing separates tasks, aligns consent and preserves release drafts", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await open(page, "screens-deck-sharing--publish-unknown-rights");
      const attribution = page.getByRole("textbox", { name: "Attribution", exact: true });
      await expectVisible(attribution);
      await attribution.fill("Draft attribution");
      const consent = page.getByRole("checkbox", { name: /I own this content/ });
      const box = await consent.boundingBox();
      const label = await page.locator('label[for="publication-reuse-confirmed"]').boundingBox();
      assert.ok(box && label && label.x > box.x + box.width && Math.abs(label.y - box.y) < 8);
      await page.getByRole("tab", { name: "Receive", exact: true }).click();
      assert.equal(await attribution.isVisible(), false);
      await page.getByRole("tab", { name: "Publish", exact: true }).click();
      assert.equal(await attribution.inputValue(), "Draft attribution");
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("materials retain import and passage drafts across all four steps", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await open(page, "screens-study-materials--coverage-plan");
      const pasted = page.getByRole("textbox", { name: "Paste study text", exact: true });
      await expectVisible(pasted);
      await pasted.fill("Unimported notes must survive step navigation.");
      await page.getByRole("tab", { name: "2. Check text" }).click();
      const passage = page
        .getByRole("textbox", { name: "Check extracted text", exact: true })
        .first();
      await expectVisible(passage);
      await passage.fill("A corrected passage kept as an unsaved draft.");
      await page.getByRole("tab", { name: "3. Choose topics" }).click();
      const goal = page.getByRole("textbox", { name: "Study goal", exact: true });
      await goal.fill("Explain shared storage");
      await page.getByRole("tab", { name: "4. Generate" }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "Study goal", exact: true }).inputValue(),
        "Explain shared storage",
      );
      await page.getByRole("tab", { name: "2. Check text" }).click();
      assert.equal(await passage.inputValue(), "A corrected passage kept as an unsaved draft.");
      await page.getByRole("tab", { name: "1. Import" }).click();
      assert.equal(await pasted.inputValue(), "Unimported notes must survive step navigation.");
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("review settings retain edits and reveal invalid fields in hidden sections", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await open(page, "knowledge-review-settings--default-retention");
      const retention = page.getByRole("spinbutton", { name: "Exact target (%)" });
      await expectVisible(retention);
      await retention.fill("99");
      await page.getByRole("tab", { name: "Scheduling", exact: true }).click();
      await page.getByRole("button", { name: "Save settings", exact: true }).click();
      await expectVisible(retention);
      assert.equal(await retention.inputValue(), "99");
      await retention.fill("91");
      await page.getByRole("tab", { name: "Presets", exact: true }).click();
      await page.getByRole("tab", { name: "Daily study", exact: true }).click();
      assert.equal(await retention.inputValue(), "91");
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("home prioritizes subjects and proposals separate discard from approval", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await open(page, "screens-recall-dashboard--today-desktop");
      const subject = page.getByRole("link", { name: "Cell biology", exact: true });
      await expectVisible(subject);
      assert.ok((await subject.boundingBox()).y < 420);
      await page.getByRole("button", { name: "More subject actions" }).click();
      await expectVisible(page.getByRole("menuitem", { name: "Import cards", exact: true }));
      await open(page, "screens-ai-tutor--review-card-proposal");
      const discard = page.getByRole("button", { name: "Discard", exact: true });
      const approve = page.getByRole("button", { name: "Approve card", exact: true });
      await expectVisible(discard);
      assert.equal(await discard.getAttribute("data-variant"), "secondary");
      const a = await discard.boundingBox();
      const b = await approve.boundingBox();
      assert.ok(a && b && (b.x >= a.x + a.width + 7 || b.y >= a.y + a.height + 7));
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("opening a cited source reveals the text step", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await open(page, "screens-study-materials--proposals");
    await page.getByRole("tab", { name: /Suggestions/ }).click();
    await page
      .getByRole("link", { name: /open source passage/ })
      .first()
      .click();
    await expectVisible(
      page.getByRole("textbox", { name: "Check extracted text", exact: true }).first(),
    );
    assert.equal(
      await page.getByRole("tab", { name: "2. Check text" }).getAttribute("aria-selected"),
      "true",
    );
  });
});

test("primary labels and error messages meet normal-text contrast", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await open(page, "screens-daily-study-reminders--blocked");
    const luminance = (color) => {
      const rgb = color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const c = value / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const contrast = (a, b) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const action = page.getByRole("button", { name: "Save reminder", exact: true });
    await expectVisible(action);
    const colors = await action.evaluate((element) => ({
      color: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
    }));
    assert.ok(contrast(colors.color, colors.background) >= 4.5);
    const alert = page.getByRole("alert");
    await expectVisible(alert);
    const error = await alert.evaluate((element) => ({
      color: getComputedStyle(element).color,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    assert.ok(contrast(error.color, error.background) >= 4.5);
  });
});
