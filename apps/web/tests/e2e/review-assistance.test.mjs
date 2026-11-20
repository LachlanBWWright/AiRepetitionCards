import assert from "node:assert/strict";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";

test("review assistance requires approval and preserves review history", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("knowledge-review-assistance--default"));
    await expectVisible(page.getByText("Saved cards: 1", { exact: true }));
    await page.getByRole("button", { name: "Explain this", exact: true }).click();
    await expectVisible(
      page.getByText(
        "Mitochondria supply ATP, while ribosomes assemble proteins from amino acids.",
        { exact: true },
      ),
    );
    await page.getByRole("button", { name: "Find the ambiguity", exact: true }).click();
    await expectVisible(
      page.getByText("This card asks about two independently recallable facts.", { exact: true }),
    );
    await page.getByRole("button", { name: "Split into smaller cards", exact: true }).click();
    await expectVisible(page.getByRole("heading", { name: "Proposed cards", exact: true }));
    assert.equal(await page.getByText("Saved cards: 1", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "Discard suggestions", exact: true }).click();
    assert.equal(
      await page.getByRole("heading", { name: "Proposed cards", exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "Split into smaller cards", exact: true }).click();
    await page.getByRole("button", { name: "Approve and save cards", exact: true }).click();
    await expectVisible(page.getByText("Saved cards: 2", { exact: true }));
    await expectVisible(page.getByText("Original present: false", { exact: true }));
    await expectVisible(page.getByText("Review events: 1", { exact: true }));
  });
});
