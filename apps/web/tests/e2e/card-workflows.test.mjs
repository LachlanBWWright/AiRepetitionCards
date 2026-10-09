import assert from "node:assert/strict";
import { test, withBrowser } from "./helpers.mjs";
import {
  addCard,
  cardRow,
  createArea,
  draftCard,
  openLibrary,
  readWorkspace,
} from "./workflow-fixtures.mjs";

const question = "What starts a goroutine?";
const answer = "The go statement starts a concurrent function call.";

test("duplicate approval is explicit, invalidated by a changed draft, and persisted", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    await addCard(page, question, answer);
    const original = await readWorkspace(page);
    const dialog = await draftCard(page, question, answer);
    await dialog.getByRole("heading", { name: "Check existing cards" }).waitFor();
    await dialog.getByRole("button", { name: "Add card", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "choose Keep both" }).waitFor();
    assert.equal((await readWorkspace(page)).areas[0].cards.length, 1);
    await dialog.getByLabel("Keep both cards", { exact: true }).check();
    await dialog
      .getByLabel("Answer", { exact: true })
      .fill(`${answer} It does not wait for completion.`);
    assert.equal(await dialog.getByLabel("Keep both cards", { exact: true }).isChecked(), false);
    await dialog.getByRole("button", { name: "Add card", exact: true }).click();
    assert.equal((await readWorkspace(page)).areas[0].cards.length, 1);
    await dialog.getByLabel("Keep both cards", { exact: true }).check();
    await dialog.getByRole("button", { name: "Add card", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const saved = await readWorkspace(page);
    assert.equal(saved.areas[0].cards.length, 2);
    assert.equal(saved.areas[0].cards[0].id, original.areas[0].cards[0].id);
    assert.notEqual(saved.areas[0].cards[0].id, saved.areas[0].cards[1].id);
    await page.reload();
    await openLibrary(page);
    await page.getByText("2 of 2 cards", { exact: true }).waitFor();
    assert.deepEqual((await readWorkspace(page)).areas[0].cards, saved.areas[0].cards);
    await page.getByText("Find duplicates", { exact: true }).click();
    await page.getByRole("button", { name: "Open matching card", exact: true }).first().waitFor();
    const scan = page
      .locator("details")
      .filter({ has: page.getByText("Find duplicates", { exact: true }) });
    await scan.getByText("Compare answers", { exact: true }).click();
    await scan.getByText(`${answer} It does not wait for completion.`, { exact: true }).waitFor();
  });
});

test("opening an existing duplicate discards only the draft and excludes itself when editing", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    await addCard(page, question, answer);
    const before = await readWorkspace(page);
    const dialog = await draftCard(page, question, answer);
    page.once("dialog", (prompt) => prompt.accept());
    await dialog.getByRole("button", { name: "Open existing card", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit card", exact: true });
    await edit.waitFor();
    assert.equal(await edit.getByLabel("Question", { exact: true }).inputValue(), question);
    assert.equal(await edit.getByRole("heading", { name: "Check existing cards" }).count(), 0);
    await edit.getByLabel("Answer", { exact: true }).fill("A go statement launches a goroutine.");
    await edit.getByRole("button", { name: "Save changes", exact: true }).click();
    await edit.waitFor({ state: "hidden" });
    const saved = await readWorkspace(page);
    assert.equal(saved.areas[0].cards.length, 1);
    assert.equal(saved.areas[0].cards[0].id, before.areas[0].cards[0].id);
    assert.equal(saved.areas[0].cards[0].back, "A go statement launches a goroutine.");
  });
});

test("review, edit, restore, delete and recover retain review history across reloads", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    await addCard(page, question, answer);
    const cardId = (await readWorkspace(page)).areas[0].cards[0].id;
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: /Today/ })
      .click();
    await page.getByRole("button", { name: /^Show answer/ }).click();
    await page.getByRole("button", { name: /^Good(?: · 3)?$/ }).click();
    await page.getByText("1 reviewed today", { exact: false }).waitFor();
    const reviewed = await readWorkspace(page);
    assert.equal(reviewed.reviewEvents.length, 1);
    await openLibrary(page);
    await cardRow(page, question)
      .getByRole("button", { name: `Edit card: ${question}`, exact: true })
      .click();
    const edit = page.getByRole("dialog", { name: "Edit card", exact: true });
    await edit.getByLabel("Answer", { exact: true }).fill("An edited answer about goroutines.");
    await edit.getByRole("button", { name: "Save changes", exact: true }).click();
    await edit.waitFor({ state: "hidden" });
    await cardRow(page, question).getByText("History", { exact: true }).click();
    const history = cardRow(page, question).getByRole("region", { name: "Earlier versions" });
    await history
      .getByRole("button", { name: /· edit$/ })
      .first()
      .click();
    await history.getByRole("heading", { name: "Selected version", exact: true }).waitFor();
    await history.getByText(answer, { exact: true }).waitFor();
    await history.getByRole("button", { name: "Restore this version", exact: true }).click();
    await history.getByText("Card restored.", { exact: true }).waitFor();
    const restored = await readWorkspace(page);
    assert.equal(restored.areas[0].cards[0].back, answer);
    assert.equal(restored.areas[0].cards[0].id, cardId);
    assert.deepEqual(restored.reviewEvents, reviewed.reviewEvents);
    assert.deepEqual(restored.areas[0].cards[0].schedule, reviewed.areas[0].cards[0].schedule);
    await cardRow(page, question).getByText("More", { exact: true }).click();
    page.once("dialog", (prompt) => prompt.accept());
    await cardRow(page, question)
      .getByRole("button", { name: `Delete card: ${question}`, exact: true })
      .click();
    await page.getByText("0 of 0 cards", { exact: true }).waitFor();
    const deleted = await readWorkspace(page);
    assert.deepEqual(deleted.reviewEvents, reviewed.reviewEvents);
    await page.getByText("Deleted cards (1)", { exact: true }).click();
    const recovery = page.getByRole("region", { name: "Deleted card", exact: true });
    await recovery
      .getByRole("button", { name: /· delete$/ })
      .first()
      .click();
    await recovery.getByRole("button", { name: /^Restore (this version|as a new copy)$/ }).click();
    await page.getByText("1 of 1 cards", { exact: true }).waitFor();
    const recovered = await readWorkspace(page);
    assert.deepEqual(recovered.reviewEvents, reviewed.reviewEvents);
    assert.equal(recovered.areas[0].cards[0].front, question);
    assert.ok(recovered.cardVersions.length > restored.cardVersions.length);
    await page.reload();
    await openLibrary(page);
    await cardRow(page, question).waitFor();
    assert.deepEqual(await readWorkspace(page), recovered);
  });
});

test("cancelled duplicate drafts and invalid cloze input do not change durable content", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    await addCard(page, question, answer);
    const before = await readWorkspace(page);
    const duplicate = await draftCard(page, question, answer);
    await duplicate.getByLabel("Keep both cards", { exact: true }).check();
    await duplicate.getByRole("button", { name: "Cancel", exact: true }).click();
    await duplicate.waitFor({ state: "hidden" });
    assert.deepEqual(await readWorkspace(page), before);
    const invalid = await draftCard(page, "", "");
    assert.equal(
      await invalid.getByRole("button", { name: "Add card", exact: true }).isEnabled(),
      false,
    );
    await invalid.getByLabel("Card type", { exact: true }).selectOption("cloze");
    await invalid.getByLabel("Cloze text", { exact: true }).fill("The answer is {{c1::Go}}.");
    await invalid.getByLabel("Deletion number to study", { exact: true }).fill("2");
    await invalid
      .getByText("Add a valid deletion matching the selected number to preview this card.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await invalid.getByRole("button", { name: "Add card", exact: true }).isEnabled(),
      false,
    );
    await invalid.getByRole("button", { name: "Cancel", exact: true }).click();
    await invalid.waitFor({ state: "hidden" });
    assert.deepEqual(await readWorkspace(page), before);
  });
});
