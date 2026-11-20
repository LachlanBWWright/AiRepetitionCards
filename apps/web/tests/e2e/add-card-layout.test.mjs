import assert from "node:assert/strict";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";

for (const width of [320, 390, 768, 1440]) {
  test(`add card uses available space and retains optional content at ${width}px`, async (t) => {
    const height = width < 400 ? 844 : 1000;
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl("screens-recall-dashboard--add-card-with-media"));
        const dialog = page.getByRole("dialog", { name: "Add card", exact: true });
        await expectVisible(dialog);
        const question = dialog.getByRole("textbox", { name: "Question", exact: true });
        const answer = dialog.getByRole("textbox", { name: "Answer", exact: true });
        const bounds = await dialog.boundingBox();
        assert.ok(bounds && bounds.x >= 16 && bounds.x + bounds.width <= width - 16);
        if (width >= 1000) {
          assert.ok(bounds.width >= 1000, "Desktop editor should use a wide dialog");
          const front = await question.boundingBox();
          const back = await answer.boundingBox();
          assert.ok(front && back && Math.abs(front.y - back.y) < 2 && back.x > front.x);
        }
        const media = dialog.getByRole("button", {
          name: "Tags, objectives and media",
          exact: true,
        });
        assert.equal(await media.getAttribute("aria-expanded"), "false");
        assert.equal(
          await dialog.getByRole("button", { name: "Record pronunciation" }).isVisible(),
          false,
        );
        await question.fill("What distinguishes an index from a pointer?");
        await answer.fill("An index identifies a slot in the list’s backing storage.");
        const explanation = dialog.getByRole("button", {
          name: "Explanation (optional)",
          exact: true,
        });
        await explanation.click();
        const context = dialog.getByRole("textbox", {
          name: "Explanation (optional)",
          exact: true,
        });
        await context.fill("Indices stay meaningful when the backing array moves.");
        await explanation.click();
        await explanation.click();
        assert.equal(
          await context.inputValue(),
          "Indices stay meaningful when the backing array moves.",
        );
        await media.click();
        await expectVisible(dialog.getByRole("button", { name: "Record pronunciation" }));
        const tags = dialog.getByRole("textbox", { name: "Tags", exact: true });
        await tags.fill("rust, collections");
        await media.click();
        await media.click();
        assert.equal(await tags.inputValue(), "rust, collections");
        const save = dialog.getByRole("button", { name: "Save card", exact: true });
        const footer = await save.boundingBox();
        assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= height);
        assert.equal(await save.isEnabled(), true);
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
        await media.click();
        await explanation.click();
        await question.scrollIntoViewIfNeeded();
        await page.waitForFunction(
          () =>
            !document
              .querySelector('[role="dialog"]')
              ?.getAnimations({ subtree: true })
              .some((animation) => animation.playState === "running"),
        );
        await page.screenshot({ path: `../../artifacts/add-card-${width}.png`, fullPage: true });
      },
      { viewport: { width, height } },
    );
  });
}

test("native card editor keeps optional tools out of the primary writing flow", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-workspace-authoring--new-card-draft"));
      const question = page.getByRole("textbox", { name: "Question", exact: true });
      await expectVisible(question);
      await question.fill("How does an index identify a node?");
      await page
        .getByRole("textbox", { name: "Answer", exact: true })
        .fill("It names a slot in storage.");
      const trigger = page.getByRole("button", { name: "Explanation (optional)", exact: true });
      const explanation = page.getByRole("textbox", {
        name: "Explanation (optional)",
        exact: true,
      });
      assert.equal(await explanation.isVisible(), false);
      await trigger.click();
      await explanation.fill("The storage can move without invalidating the index.");
      await trigger.click();
      await trigger.click();
      assert.equal(
        await explanation.inputValue(),
        "The storage can move without invalidating the index.",
      );
      await trigger.click();
      assert.equal(
        await page
          .getByRole("button", { name: "Images and audio", exact: true })
          .getAttribute("aria-expanded"),
        "false",
      );
      assert.equal(
        await page.getByRole("button", { name: "Save card", exact: true }).isEnabled(),
        true,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({ path: "../../artifacts/add-card-native.png", fullPage: true });
    },
    { viewport: { width: 390, height: 844 } },
  );
});
