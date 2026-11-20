import assert from "node:assert/strict";
import { test, expectVisible, storyUrl, withBrowser } from "./helpers.mjs";

test("tutor automatically resumes messages and drafts without save or research controls", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("knowledge-tutor-conversation--default"));
    const input = page.getByRole("textbox", { name: "Tutor message", exact: true });
    await expectVisible(input);
    assert.equal(
      await page.getByText("Keep this conversation on this device", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "Research tools", exact: true }).count(),
      0,
    );
    await input.fill("Explain mitochondria");
    await input.press("Enter");
    await expectVisible(
      page.getByText("Mitochondria generate ATP through cellular respiration.", { exact: true }),
    );
    await input.fill("What happens next?");
    await page.waitForFunction(() =>
      Object.keys(localStorage).some(
        (key) =>
          key.startsWith("recall-tutor-conversation:") &&
          localStorage.getItem(key)?.includes("What happens next?"),
      ),
    );
    await page.reload();
    await expectVisible(
      page.getByText("Mitochondria generate ATP through cellular respiration.", { exact: true }),
    );
    assert.equal(await input.inputValue(), "What happens next?");
    await page.getByRole("button", { name: "Switch account and provider", exact: true }).click();
    await expectVisible(
      page.getByRole("heading", { name: "What would you like to understand?", exact: true }),
    );
    assert.equal(await input.inputValue(), "");
    assert.equal(await page.getByText("Explain mitochondria", { exact: true }).count(), 0);
  });
});
