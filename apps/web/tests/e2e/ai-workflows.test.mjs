import assert from "node:assert/strict";
import { test, expectVisible, withBrowser, storyUrl } from "./helpers.mjs";

test("refinement requires duplicate consent before applying", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-card-assistance--duplicate-refinement"));
    const apply = page.getByRole("button", { name: "Apply proposed changes", exact: true });
    await expectVisible(apply);
    assert.equal(await apply.isDisabled(), true);
    await page.getByText("Compare answer", { exact: true }).click();
    await expectVisible(
      page.getByText("It passes values between goroutines.", { exact: true }).last(),
    );
    const consent = page.getByRole("checkbox", { name: "Keep both cards", exact: true });
    await consent.check();
    assert.equal(await apply.isEnabled(), true);
    await consent.uncheck();
    assert.equal(await apply.isDisabled(), true);
    await consent.check();
    await apply.click();
    await page
      .getByRole("heading", { name: "Review proposed changes", exact: true })
      .waitFor({ state: "hidden" });
  });
});

test("split refinements can be discarded without changing the original", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-card-assistance--split-preview"));
    await expectVisible(page.getByRole("heading", { name: "Original", exact: true }));
    await expectVisible(
      page.getByText("When can append allocate a new backing array in Go?", { exact: true }),
    );
    await page.getByRole("button", { name: "Discard suggestion", exact: true }).click();
    await page
      .getByRole("heading", { name: "Review proposed changes", exact: true })
      .waitFor({ state: "hidden" });
    await expectVisible(page.getByRole("button", { name: "Close improvements", exact: true }));
  });
});

test("failed refinement save retains the proposal for retry", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-card-assistance--refinement-save-failure"));
    const approve = page.getByRole("button", { name: "Approve replacement cards", exact: true });
    await expectVisible(approve);
    await approve.click();
    await expectVisible(page.getByRole("alert"));
    assert.match(await page.getByRole("alert").innerText(), /not saved|remain/i);
    await expectVisible(
      page.getByRole("heading", { name: "Review proposed changes", exact: true }),
    );
    assert.equal(await approve.isEnabled(), true);
  });
});

test("offline card improvements keep local checks but disable AI requests", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-card-assistance--offline"));
    await page.getByRole("button", { name: "Improve", exact: true }).click();
    const quality = page.getByRole("button", { name: "Check quality", exact: true });
    await expectVisible(quality);
    assert.equal(await quality.isDisabled(), true);
    await page.getByText("Custom instructions", { exact: true }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "Instructions", exact: true }).isDisabled(),
      true,
    );
  });
});

test("budget refresh preserves edited limits and usage details remain accessible", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-ai-budget-settings--usage"));
    const daily = page.getByRole("textbox", { name: "Daily requests", exact: true });
    await expectVisible(daily);
    await daily.fill("7");
    await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
    await page
      .getByRole("button", { name: "Refresh usage", exact: true })
      .waitFor({ state: "visible" });
    assert.equal(await daily.inputValue(), "7");
    await page.getByText("Usage details and reset times", { exact: true }).click();
    await expectVisible(page.getByText(/Failed and pending requests count/));
    await daily.fill("-1");
    await page.getByRole("button", { name: "Save limits", exact: true }).click();
    await expectVisible(page.getByRole("status"));
    assert.match(await page.getByRole("status").innerText(), /whole numbers/);
    assert.equal(await daily.inputValue(), "-1");
  });
});

test("failed budget save keeps all edited request caps", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-ai-budget-settings--save-unavailable"));
    const fields = ["Daily requests", "Weekly requests", "Daily research requests"];
    for (const [index, name] of fields.entries()) {
      await page.getByRole("textbox", { name, exact: true }).fill(String(index + 3));
    }
    await page.getByRole("button", { name: "Save limits", exact: true }).click();
    await expectVisible(page.getByRole("status"));
    assert.match(await page.getByRole("status").innerText(), /not been saved/);
    for (const [index, name] of fields.entries()) {
      assert.equal(
        await page.getByRole("textbox", { name, exact: true }).inputValue(),
        String(index + 3),
      );
    }
  });
});

test("material draft survives switching activities before import", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-study-materials--ready"));
    await page.getByRole("button", { name: "Study materials", exact: true }).click();
    const text = page.getByRole("textbox", { name: "Paste study text", exact: true });
    await expectVisible(text);
    await page
      .getByRole("textbox", { name: "Material name", exact: true })
      .fill("Unfinished Go notes");
    await text.fill("A slice describes a segment of an underlying array.");
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    await page.getByRole("button", { name: "Study materials", exact: true }).click();
    assert.equal(await text.inputValue(), "A slice describes a segment of an underlying array.");
    assert.equal(
      await page.getByRole("textbox", { name: "Material name", exact: true }).inputValue(),
      "Unfinished Go notes",
    );
  });
});

test("answer drafts survive activity switches", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-knowledge-notebook--question"));
    const answer = page.getByRole("textbox", { name: "Your answer", exact: true });
    await expectVisible(answer);
    await answer.fill("The two slice descriptors share their backing array.");
    await page
      .getByRole("combobox", { name: "How confident are you?", exact: true })
      .selectOption("confident");
    await page.getByRole("button", { name: "Study materials", exact: true }).click();
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    assert.equal(await answer.inputValue(), "The two slice descriptors share their backing array.");
    assert.equal(
      await page
        .getByRole("combobox", { name: "How confident are you?", exact: true })
        .inputValue(),
      "confident",
    );
  });
});

test("source proposals expose exact quote and preserve edited questions across activities", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-study-materials--proposals"));
    await page.getByRole("button", { name: "Review suggestions", exact: true }).click();
    const question = page.getByRole("textbox", { name: "Question", exact: true });
    await expectVisible(question);
    await question.fill("Does copying a slice create separate element storage?");
    await page.getByText("Source: Go workshop — slices.pdf · page 7", { exact: true }).click();
    await expectVisible(
      page.getByText("Copying a slice does not copy its backing array.", { exact: true }),
    );
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    await page.getByRole("button", { name: "Review suggestions", exact: true }).click();
    assert.equal(
      await question.inputValue(),
      "Does copying a slice create separate element storage?",
    );
  });
});

test("edited originals invalidate pending refinement approval", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-card-assistance--edited-refinement-baseline"));
    const approve = page.getByRole("button", { name: "Approve replacement cards", exact: true });
    await expectVisible(approve);
    assert.equal(await approve.isEnabled(), true);
    await page
      .getByRole("textbox", { name: "Original question", exact: true })
      .fill("A changed original question");
    await expectVisible(page.getByRole("alert"));
    assert.match(await page.getByRole("alert").innerText(), /card changed/);
    assert.equal(await approve.isDisabled(), true);
  });
});

test("local card quality feedback is available before any AI action", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-card-assistance--local-quality"));
    await expectVisible(page.getByText(/The question uses an absolute or subjective comparison/));
    await expectVisible(page.getByRole("button", { name: "Improve", exact: true }));
    assert.equal(await page.getByRole("button", { name: "Check quality", exact: true }).count(), 0);
  });
});

test("coverage topics retain selection and priority across activities", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-study-materials--coverage-plan"));
    await page.getByRole("button", { name: "Study materials", exact: true }).click();
    const claim = page.locator(
      "article[data-search-target='claim:00000000-0000-4000-8000-000000000032']",
    );
    await expectVisible(claim);
    await claim
      .getByRole("combobox", { name: "Include topic", exact: true })
      .selectOption("selected");
    await claim.getByRole("combobox", { name: "Priority", exact: true }).selectOption("high");
    await claim.getByText("Source passages", { exact: true }).click();
    await expectVisible(
      claim.getByText("An append may reuse capacity or allocate a new array.", { exact: true }),
    );
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    await page.getByRole("button", { name: "Study materials", exact: true }).click();
    assert.equal(
      await claim.getByRole("combobox", { name: "Include topic", exact: true }).inputValue(),
      "selected",
    );
    assert.equal(
      await claim.getByRole("combobox", { name: "Priority", exact: true }).inputValue(),
      "high",
    );
  });
});
