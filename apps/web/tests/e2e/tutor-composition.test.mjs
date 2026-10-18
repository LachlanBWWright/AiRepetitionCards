import assert from "node:assert/strict";
import { test, expectVisible, withBrowser, storyUrl } from "./helpers.mjs";

test("evaluating a quick quiz answer preserves the other answer draft", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-ai-tutor--multiple-quiz-drafts"));
    const first = page.getByRole("textbox", { name: "Your answer to question 1", exact: true });
    const second = page.getByRole("textbox", { name: "Your answer to question 2", exact: true });
    await expectVisible(first);
    await first.fill("Mitochondria supply ATP.");
    await second.fill("Transcription occurs in the nucleus.");
    await page.getByRole("button", { name: "Check answer", exact: true }).first().click();
    await first.waitFor({ state: "hidden" });
    await expectVisible(page.getByText("Compare with a sample answer", { exact: true }));
    assert.equal(await second.inputValue(), "Transcription occurs in the nucleus.");
  });
});

test("failed quick proposal approval preserves edits and allows retry", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-ai-tutor--approval-storage-failure"));
    const question = page.getByRole("textbox", { name: "Question", exact: true });
    await expectVisible(question);
    await question.fill("Which molecule supplies usable cellular energy?");
    const approve = page.getByRole("button", { name: "Approve card", exact: true });
    await approve.click();
    await expectVisible(page.getByText(/The card could not be saved locally.*edits are still/));
    assert.equal(await question.inputValue(), "Which molecule supplies usable cellular energy?");
    assert.equal(await approve.isEnabled(), true);
  });
});

test("saved quick proposal retries approval without enabling content edits", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-ai-tutor--approval-retry"));
    const question = page.getByRole("textbox", { name: "Question", exact: true });
    await expectVisible(question);
    assert.equal(await question.isDisabled(), true);
    assert.equal(
      await page.getByRole("button", { name: "Discard", exact: true }).isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "Retry approval", exact: true }).click();
    await question.waitFor({ state: "hidden" });
  });
});
