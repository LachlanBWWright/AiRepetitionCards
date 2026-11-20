import assert from "node:assert/strict";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";

const answer = "Mitochondria generate ATP through cellular respiration.";
test("tutor retention is opt-in, resumes locally, isolates accounts, and deletes", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("knowledge-tutor-retention--default"));
    const keep = page.getByRole("checkbox", { name: "Keep this conversation on this device" });
    const input = page.getByRole("textbox", { name: "Tutor message", exact: true });
    await expectVisible(input);
    assert.equal(await keep.isChecked(), false);
    await input.fill("Explain mitochondria");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expectVisible(page.getByText(answer, { exact: true }));
    await page.reload();
    await expectVisible(input);
    assert.equal(await page.getByText(answer, { exact: true }).count(), 0);
    await keep.click();
    await expectVisible(
      page.getByRole("checkbox", { name: "Keep this conversation on this device", checked: true }),
    );
    await input.fill("Explain mitochondria");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expectVisible(page.getByText(answer, { exact: true }));
    await page.waitForFunction(
      (text) =>
        Object.keys(localStorage).some(
          (key) =>
            key.startsWith("recall-tutor-conversation:") &&
            localStorage.getItem(key)?.includes(text),
        ),
      answer,
    );
    await page.reload();
    await expectVisible(page.getByText(answer, { exact: true }));
    assert.equal(await keep.isChecked(), true);
    await page.getByRole("button", { name: "Switch account and provider", exact: true }).click();
    await expectVisible(page.getByText("Current scope: account-b:provider-b", { exact: true }));
    assert.equal(await page.getByText(answer, { exact: true }).count(), 0);
    assert.equal(await keep.isChecked(), false);
    await page.getByRole("button", { name: "Switch account and provider", exact: true }).click();
    await expectVisible(page.getByText(answer, { exact: true }));
    await page
      .getByRole("button", { name: "Delete conversation and start fresh", exact: true })
      .click();
    await page.waitForFunction(
      () => !Object.keys(localStorage).some((key) => key.startsWith("recall-tutor-conversation:")),
    );
    await page.reload();
    await expectVisible(input);
    assert.equal(await page.getByText(answer, { exact: true }).count(), 0);
    assert.equal(await keep.isChecked(), false);
  });
});
