import assert from "node:assert/strict";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";

test("ordering supports keyboard-accessible reordering and restored drafts", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("learning-activities-interactive-games--ordering"));
    await expectVisible(page.getByRole("list", { name: "Your ordering" }));
    const before = await page.getByRole("list", { name: "Your ordering" }).innerText();
    await page.getByRole("button", { name: "Move item 2 up", exact: true }).click();
    assert.notEqual(await page.getByRole("list", { name: "Your ordering" }).innerText(), before);
    await expectVisible(page.getByText("Order ready to check.", { exact: true }));
    await page.goto(storyUrl("learning-activities-interactive-games--resumed-ordering"));
    const text = await page.getByRole("list", { name: "Your ordering" }).innerText();
    assert.ok(text.indexOf("Subtract") < text.indexOf("Divide"));
  });
});

test("inline activities pause review and returning preserves manual rating", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("review-inline-learning-activities--explicit-start-and-rating"));
    await expectVisible(page.getByText("No review recorded", { exact: true }));
    await page.getByRole("button", { name: "Start linked activity", exact: true }).click();
    await expectVisible(page.getByRole("button", { name: "Return to card", exact: true }));
    await page.keyboard.press(" ");
    await expectVisible(page.getByText("No review recorded", { exact: true }));
    await page.getByLabel("Your response 1", { exact: true }).fill("My recalled answer");
    await page.getByRole("button", { name: "Meets rubric", exact: true }).click();
    await page.getByRole("button", { name: "Review assessment", exact: true }).click();
    await page.getByRole("button", { name: "Accept and record attempt", exact: true }).click();
    await expectVisible(page.getByText("Activities retained: 2", { exact: true }));
    await expectVisible(page.getByText("Accepted attempts: 1", { exact: true }));
    await expectVisible(page.getByText("No review recorded", { exact: true }));
    await page.getByRole("button", { name: "Return to card", exact: true }).click();
    await expectVisible(page.getByRole("button", { name: "Start linked activity", exact: true }));
    await expectVisible(page.getByText("No review recorded", { exact: true }));
  });
});

test("coding Run and Submit stay provisional until acceptance", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("learning-activities-assessment-journey--coding"));
    await page.getByRole("button", { name: "Run examples", exact: true }).click();
    await expectVisible(page.getByText(/Example run: passed.*1\/1 passed/));
    await expectVisible(page.getByText("Accepted attempts: 0", { exact: true }));
    await page.getByRole("button", { name: "Submit solution", exact: true }).click();
    await expectVisible(page.getByText(/Full submission: passed.*2\/2 passed/));
    await expectVisible(page.getByText("Accepted attempts: 0", { exact: true }));
    await page.getByRole("button", { name: "Accept and record attempt", exact: true }).click();
    await expectVisible(page.getByText("Accepted attempts: 1", { exact: true }));
  });
});

test("Lua host actions feed replayed assessment and explicit acceptance", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("learning-activities-assessment-journey--lua"));
    await page.getByRole("button", { name: "Open or resume Lua activity", exact: true }).click();
    for (let count = 1; count <= 3; count++) {
      await page.getByRole("button", { name: "Add one", exact: true }).click();
      await expectVisible(page.getByText(`Count: ${count}`, { exact: true }));
    }
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await page.getByRole("button", { name: "Accept and record attempt", exact: true }).click();
    await expectVisible(page.getByText("Accepted attempts: 1", { exact: true }));
  });
});
