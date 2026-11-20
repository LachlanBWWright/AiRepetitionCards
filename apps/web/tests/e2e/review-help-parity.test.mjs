import assert from "node:assert/strict";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";
const duplicateLabel = "These suggestions overlap existing cards. Keep duplicates anyway.";
async function open(page, native, scenario = "preview") {
  const story = native
    ? `native-${scenario}`
    : scenario === "preview"
      ? "dialog-preview"
      : `web-${scenario}`;
  await page.goto(storyUrl(`knowledge-review-assistance--${story}`));
  if (native) {
    await page.getByRole("button", { name: "Help with this card", exact: true }).click();
    await expectVisible(page.getByText("Reviews paused: true", { exact: true }));
  }
}
for (const native of [false, true]) {
  const platform = native ? "React Native" : "Next.js";
  test(`${platform} card help renders rich responses and requires approval to save`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await open(page, native);
        const choice = page.getByRole("button", { name: "Explain this", exact: true });
        assert.ok((await choice.boundingBox())?.height >= 44, "Choices need touch-sized targets");
        await page.getByRole("button", { name: "View current answer", exact: true }).click();
        await expectVisible(page.getByText(/Mitochondria produce ATP/));
        await page.getByRole("button", { name: "Explain this", exact: true }).click();
        await expectVisible(page.getByRole("heading", { name: "Tutor response", exact: true }));
        await expectVisible(page.getByText("ATP", { exact: true }));
        assert.equal((await page.locator("body").innerText()).includes("`ATP`"), false);
        await page.getByRole("button", { name: "View current answer", exact: true }).click();
        await page.screenshot({
          path: `../../artifacts/card-help-${native ? "react-native" : "nextjs"}-storybook.png`,
          fullPage: true,
        });
        await page.getByRole("button", { name: "Split into smaller cards", exact: true }).click();
        await expectVisible(page.getByRole("heading", { name: "Proposed cards", exact: true }));
        await expectVisible(page.getByText("Saved cards: 1", { exact: true }));
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
        assert.equal(
          await page.getByRole("alert").count(),
          0,
          "Success must not be announced as an error",
        );
        if (native) {
          await page.getByRole("button", { name: "Help with this card", exact: true }).click();
          await expectVisible(page.getByText("Reviews paused: false", { exact: true }));
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true,
        );
      },
      { viewport: { width: 390, height: 844 } },
    );
  });
  test(`${platform} requires explicit duplicate approval`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await open(page, native, "duplicates");
        await page.getByRole("button", { name: "Split into smaller cards", exact: true }).click();
        const approval = page.getByRole("button", { name: "Approve and save cards", exact: true });
        await expectVisible(approval);
        assert.equal(await approval.isDisabled(), true);
        await page
          .getByRole(native ? "switch" : "checkbox", { name: duplicateLabel, exact: true })
          .click();
        assert.equal(await approval.isEnabled(), true);
      },
      { viewport: { width: 390, height: 844 } },
    );
  });
  test(`${platform} hides stale responses while busy and announces failures`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await open(page, native, "slow");
        await page.getByRole("button", { name: "Explain this", exact: true }).click();
        await expectVisible(page.getByText("Working on this card…", { exact: true }));
        assert.equal(
          await page.getByRole("button", { name: "Explain this", exact: true }).isDisabled(),
          true,
        );
        await expectVisible(page.getByRole("heading", { name: "Tutor response", exact: true }));
        await page.getByRole("button", { name: "Split into smaller cards", exact: true }).click();
        await expectVisible(page.getByText("Working on this card…", { exact: true }));
        assert.equal(
          await page.getByRole("heading", { name: "Tutor response", exact: true }).count(),
          0,
        );
        await expectVisible(page.getByRole("heading", { name: "Proposed cards", exact: true }));
        await open(page, native, "failure");
        await page.getByRole("button", { name: "Explain this", exact: true }).click();
        await expectVisible(page.getByRole("alert"));
        await expectVisible(page.getByText("Saved cards: 1", { exact: true }));
      },
      { viewport: { width: 390, height: 844 } },
    );
  });
}
test("React Native read-only help can generate suggestions but cannot approve them", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await open(page, true, "readonly");
      await page.getByRole("button", { name: "Split into smaller cards", exact: true }).click();
      const approval = page.getByRole("button", { name: "Approve and save cards", exact: true });
      await expectVisible(approval);
      assert.equal(await approval.isDisabled(), true);
    },
    { viewport: { width: 390, height: 844 } },
  );
});
