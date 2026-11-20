import assert from "node:assert/strict";
import { test, expectVisible, storyUrl, withBrowser } from "./helpers.mjs";

async function prepare(page, native = false) {
  await page.goto(storyUrl(`tutor-external-ai-handover--${native ? "native" : "web"}`));
  await page.getByRole("button", { name: "Prepare handover", exact: true }).click();
  const output = page.getByTestId("agent-handover-output");
  await expectVisible(output);
  const raw = native ? await output.textContent() : await output.inputValue();
  return JSON.parse(raw);
}
function proposal(handover, operations) {
  return JSON.stringify({ ...handover.proposalTemplate, operations });
}
const update = {
  op: "update-card",
  deckId: "rust",
  cardId: "ownership",
  front: "How does Rust borrowing differ from moving?",
  back: "Borrowing grants temporary access; moving transfers ownership.",
  explanation: "References borrow values.",
  tags: ["rust", "ownership"],
};
for (const native of [false, true]) {
  test(`${native ? "native" : "web"} external handover validates and previews before applying`, async (t) => {
    await withBrowser(t, async ({ page }) => {
      const handover = await prepare(page, native);
      assert.equal(handover.format, "recall-agent-handover");
      assert.deepEqual(handover.conversation, []);
      assert.deepEqual(handover.reviews, []);
      assert.match(handover.instructions, /Converse first/);
      await page
        .getByRole("textbox", { name: "Paste the agent’s change-proposal JSON", exact: true })
        .fill(proposal(handover, [update]));
      await page.getByRole("button", { name: "Validate and preview", exact: true }).click();
      await expectVisible(
        page.getByRole("button", { name: "Apply approved changes", exact: true }),
      );
      assert.match(await page.getByTestId("current-card").innerText(), /What is borrowing/);
      await page.getByRole("button", { name: /Update card in Rust programming/ }).click();
      await expectVisible(page.getByText("Before", { exact: true }));
      await expectVisible(page.getByText("After", { exact: true }));
      await page.getByRole("button", { name: "Apply approved changes", exact: true }).click();
      await expectVisible(page.getByText(`Saved card: ${update.front}`, { exact: true }));
      await expectVisible(page.getByText("Approved changes saved.", { exact: true }));
      // Reusing the old snapshot must fail rather than overwrite the new card.
      await page
        .getByRole("textbox", { name: "Paste the agent’s change-proposal JSON", exact: true })
        .fill(proposal(handover, [update]));
      await page.getByRole("button", { name: "Validate and preview", exact: true }).click();
      await expectVisible(page.getByText(/A deck changed since this handover/));
    });
  });
}
test("deletions require separate approval and editing JSON clears a previous preview", async (t) => {
  await withBrowser(t, async ({ page }) => {
    const handover = await prepare(page);
    const input = page.getByRole("textbox", {
      name: "Paste the agent’s change-proposal JSON",
      exact: true,
    });
    await input.fill(
      proposal(handover, [{ op: "delete-card", deckId: "rust", cardId: "ownership" }]),
    );
    await page.getByRole("button", { name: "Validate and preview", exact: true }).click();
    const apply = page.getByRole("button", { name: "Apply approved changes", exact: true });
    assert.equal(await apply.isDisabled(), true);
    await page
      .getByRole("checkbox", { name: "I approve the listed deletions", exact: true })
      .click();
    assert.equal(await apply.isDisabled(), false);
    await input.fill('{"unexpected":true}');
    assert.equal(await apply.count(), 0);
    await page.getByRole("button", { name: "Validate and preview", exact: true }).click();
    await expectVisible(page.getByText(/Invalid change proposal/));
    assert.match(await page.getByTestId("current-card").innerText(), /What is borrowing/);
  });
});

test("handover JSON can be copied, downloaded and imported from a file", async (t) => {
  await withBrowser(t, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const handover = await prepare(page);
    await page.getByRole("button", { name: "Copy handover", exact: true }).click();
    await expectVisible(page.getByText("Handover copied.", { exact: true }));
    assert.equal(
      JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).handoverId,
      handover.handoverId,
    );
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save JSON", exact: true }).click();
    assert.equal((await download).suggestedFilename(), "recall-agent-handover.json");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open JSON", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: "changes.json",
      mimeType: "application/json",
      buffer: Buffer.from(proposal(handover, [update])),
    });
    const input = page.getByRole("textbox", {
      name: "Paste the agent’s change-proposal JSON",
      exact: true,
    });
    assert.equal(JSON.parse(await input.inputValue()).format, "recall-agent-changes");
    await page.getByRole("button", { name: "Validate and preview", exact: true }).click();
    await expectVisible(page.getByRole("button", { name: "Apply approved changes", exact: true }));
  });
});

test("card selection exports only selected context and includes history only on request", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("tutor-external-ai-handover--web"));
    await page
      .getByRole("checkbox", { name: "Include all cards in this deck", exact: true })
      .click();
    await page.getByRole("button", { name: "Prepare handover", exact: true }).click();
    await expectVisible(
      page.getByText("Select at least one card or choose all cards.", { exact: true }),
    );
    await page
      .getByRole("textbox", { name: "Find cards to include", exact: true })
      .fill("borrowing");
    await page.getByRole("checkbox", { name: "What is borrowing?", exact: true }).click();
    await page
      .getByRole("checkbox", {
        name: "Include recent tutor conversation (2 messages)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Prepare handover", exact: true }).click();
    const output = JSON.parse(await page.getByTestId("agent-handover-output").inputValue());
    assert.equal(output.content[0].cards.length, 1);
    assert.equal(output.conversation.length, 2);
  });
});
