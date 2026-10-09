import assert from "node:assert/strict";
import { test, expectVisible, withBrowser, storyUrl } from "./helpers.mjs";

const mobileViewport = { viewport: { width: 390, height: 844 } };
const questionText = "What is the main role of mitochondria?";

test("native card draft survives bottom navigation", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-app-shell--card-attachments"));
      const question = page.getByRole("textbox", { name: "Question", exact: true });
      await expectVisible(question);
      await question.fill("Which molecule supplies usable energy to cells?");
      await page.getByRole("button", { name: "Today tab", exact: true }).click();
      await expectVisible(page.getByRole("button", { name: "Show answer", exact: true }));
      await page.getByRole("button", { name: "Library tab", exact: true }).click();
      assert.equal(await question.inputValue(), "Which molecule supplies usable energy to cells?");
    },
    mobileViewport,
  );
});

test("native duplicate consent resets when the draft changes or is cancelled", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-workspace-authoring--new-card-draft"));
      const question = page.getByRole("textbox", { name: "Question", exact: true });
      const answer = page.getByRole("textbox", { name: "Answer", exact: true });
      await expectVisible(question);
      await question.fill(questionText);
      await answer.fill("ATP.");
      await expectVisible(page.getByRole("button", { name: "Keep both", exact: true }));
      await page.getByRole("button", { name: "Save card", exact: true }).click();
      await expectVisible(page.getByRole("alert"));
      assert.match(await page.getByRole("alert").innerText(), /choose Keep both/);
      await page.getByRole("button", { name: "Keep both", exact: true }).click();
      await expectVisible(page.getByRole("button", { name: "Keep both selected", exact: true }));
      await answer.fill("ATP produced during cellular respiration.");
      await expectVisible(page.getByRole("button", { name: "Keep both", exact: true }));
      await page.getByRole("button", { name: "Keep both", exact: true }).click();
      await page.getByRole("button", { name: "Cancel editing", exact: true }).click();
      await page.getByRole("button", { name: "Add card", exact: true }).click();
      await question.fill(questionText);
      await answer.fill("ATP.");
      await expectVisible(page.getByRole("button", { name: "Keep both", exact: true }));
    },
    mobileViewport,
  );
});

test("native pending saves prevent draft edits and cancellation", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-workspace-authoring--pending-save-interaction"));
      const question = page.getByRole("textbox", { name: "Question", exact: true });
      await expectVisible(question);
      await page.getByRole("button", { name: "Save card", exact: true }).click();
      await expectVisible(page.getByRole("button", { name: "Complete mock save", exact: true }));
      assert.equal(await question.isEditable(), false);
      assert.equal(
        await page.getByRole("button", { name: "Cancel editing", exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await page.getByRole("button", { name: "Saving…", exact: true }).isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "Complete mock save", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Question", exact: true })
        .waitFor({ state: "hidden" });
      await expectVisible(page.getByRole("alert"));
      assert.match(await page.getByRole("alert").innerText(), /Saved/);
    },
    mobileViewport,
  );
});

test("native failed saves retain the edited card", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-workspace-authoring--persistence-failure"));
      const question = page.getByRole("textbox", { name: "Question", exact: true });
      await expectVisible(question);
      await question.fill("An unfinished revision to mitochondria.");
      await page.getByRole("button", { name: "Save card", exact: true }).click();
      await expectVisible(
        page.getByText("Storage is unavailable. Your draft remains here.", { exact: true }),
      );
      assert.equal(await question.inputValue(), "An unfinished revision to mitochondria.");
      assert.equal(await question.isEditable(), true);
    },
    mobileViewport,
  );
});

test("native search filters card results and returns explicit no matches", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-workspace-search--search"));
      const search = page.getByRole("textbox", { name: "Search everything", exact: true });
      await expectVisible(search);
      await search.fill("mitochondria");
      const result = page.getByRole("button", { name: /What is the main role of mitochondria/ });
      await expectVisible(result);
      await page.getByRole("button", { name: "Card", exact: true }).click();
      await expectVisible(page.getByText("1 matches", { exact: true }));
      await expectVisible(result);
      await search.fill("no-matching-material");
      await expectVisible(page.getByText("0 matches", { exact: true }));
      assert.equal(await result.count(), 0);
      await search.fill("");
      await expectVisible(
        page.getByText("Enter a word or phrase to search your library.", { exact: true }),
      );
    },
    mobileViewport,
  );
});

for (const [story, button] of [
  ["active-restore-interaction", "Restore this version"],
  ["deleted-restore-interaction", "Recover card"],
  ["synced-deleted-restore-interaction", "Recover as a new card"],
]) {
  test(`native history explicitly confirms ${story}`, async (t) => {
    await withBrowser(
      t,
      async ({ page }) => {
        await page.goto(storyUrl(`screens-native-card-history--${story}`));
        await expectVisible(
          page.getByText("An earlier answer saved before refinement.", { exact: true }),
        );
        assert.equal(
          await page.getByRole("status", { name: "Restore result", exact: true }).count(),
          0,
        );
        await page.getByRole("button", { name: button, exact: true }).click();
        const output = page.getByRole("status", { name: "Restore result", exact: true });
        await expectVisible(output);
        const result = JSON.parse(await output.innerText());
        assert.equal(result.command.kind, "restore-card");
        assert.equal(result.command.versionId, "mock-version-1");
        assert.equal(result.baselineCaptured, true);
      },
      mobileViewport,
    );
  });
}

test("native history cannot restore while workspace changes are pending", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-card-history--saving-disabled"));
      const restore = page.getByRole("button", { name: "Restore this version", exact: true });
      await expectVisible(restore);
      assert.equal(await restore.isDisabled(), true);
      assert.equal(
        await page.getByRole("button", { name: "Hide version", exact: true }).isDisabled(),
        true,
      );
    },
    mobileViewport,
  );
});

test("native tutor saves edited proposals only after explicit approval", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-ai-tutor--proposal-approval"));
      await page.getByRole("button", { name: "Ask the tutor", exact: true }).click();
      const question = page.getByRole("textbox", { name: "Proposed card question", exact: true });
      await expectVisible(question);
      await question.fill("Which molecule powers many cellular processes?");
      const approve = page.getByRole("button", { name: "Save & approve", exact: true });
      await expectVisible(approve);
      assert.equal(await approve.isEnabled(), true);
      await approve.click();
      await expectVisible(page.getByText("Saved.", { exact: true }));
      await question.waitFor({ state: "hidden" });
    },
    mobileViewport,
  );
});

test("native tutor retains proposal edits when local approval save fails", async (t) => {
  await withBrowser(
    t,
    async ({ page }) => {
      await page.goto(storyUrl("screens-native-ai-tutor--proposal-save-failure"));
      await page.getByRole("button", { name: "Ask the tutor", exact: true }).click();
      const question = page.getByRole("textbox", { name: "Proposed card question", exact: true });
      await expectVisible(question);
      await question.fill("Name the molecule produced during cellular respiration.");
      await page.getByRole("button", { name: "Save & approve", exact: true }).click();
      await expectVisible(
        page.getByText(
          "The card could not be saved locally, so approval was not sent. Your edits remain available to retry.",
          { exact: true },
        ),
      );
      assert.equal(
        await question.inputValue(),
        "Name the molecule produced during cellular respiration.",
      );
      assert.equal(await question.isEditable(), true);
    },
    mobileViewport,
  );
});
