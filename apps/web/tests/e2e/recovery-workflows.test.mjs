import assert from "node:assert/strict";
import { appUrl, test, waitForWorkspace, withBrowser } from "./helpers.mjs";
import {
  addCard,
  cardRow,
  createArea,
  draftCard,
  notebookFixture,
  openLibrary,
  readWorkspace,
} from "./workflow-fixtures.mjs";

const question = "Which keyword launches a goroutine?";
const answer = "The go keyword launches a concurrent function call.";

async function editCard(page) {
  await cardRow(page, question)
    .getByRole("button", { name: `Edit card: ${question}`, exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit card", exact: true });
  await editor.waitFor();
  return editor;
}

async function openSearch(page, query) {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search", exact: true });
  await dialog.waitFor();
  await dialog
    .getByText("Loading saved materials and discussions…", { exact: true })
    .waitFor({ state: "hidden" });
  await dialog.getByLabel("Search", { exact: true }).fill(query);
  return dialog;
}

// These operate on the real durable snapshot, without replacing application adapters.
async function rawSnapshot(page, replacement) {
  return page.evaluate(
    async ({ replacement }) => {
      return new Promise((resolveValue, rejectValue) => {
        const request = indexedDB.open("recall-workspace", 1);
        request.onerror = () => rejectValue(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            "snapshots",
            replacement === undefined ? "readonly" : "readwrite",
          );
          const store = transaction.objectStore("snapshots");
          let value;
          if (replacement !== undefined) store.put(replacement, "current");
          const read = store.get("current");
          read.onsuccess = () => {
            value = read.result;
          };
          transaction.oncomplete = () => {
            database.close();
            resolveValue(value);
          };
          transaction.onerror = () => {
            database.close();
            rejectValue(transaction.error);
          };
          transaction.onabort = () => {
            database.close();
            rejectValue(transaction.error);
          };
        };
      });
    },
    { replacement },
  );
}

test("two tabs reject a stale edit without losing the draft or the newer durable card", async (t) => {
  await withBrowser(t, async ({ page, context }) => {
    await createArea(page);
    await addCard(page, question, answer);
    assert.equal(await page.evaluate(() => typeof navigator.locks?.request), "function");
    const editor = await editCard(page);
    await editor.getByLabel("Answer", { exact: true }).fill("My unsaved answer in the first tab.");
    const other = await context.newPage();
    await other.goto(appUrl);
    await openLibrary(other);
    const otherEditor = await editCard(other);
    await otherEditor.getByLabel("Answer", { exact: true }).fill("The newer saved answer.");
    await otherEditor.getByRole("button", { name: "Save changes", exact: true }).click();
    await otherEditor.waitFor({ state: "hidden" });
    const latest = await waitForWorkspace(
      other,
      (workspace) => workspace?.areas[0]?.cards[0]?.back === "The newer saved answer.",
    );
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Another tab saved a newer workspace" })
      .waitFor();
    assert.equal(
      await editor.getByLabel("Answer", { exact: true }).inputValue(),
      "My unsaved answer in the first tab.",
    );
    assert.deepEqual(await readWorkspace(page), latest);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Reload latest saved workspace", exact: true }).click();
    await openLibrary(page);
    const reloaded = await editCard(page);
    assert.equal(
      await reloaded.getByLabel("Answer", { exact: true }).inputValue(),
      "The newer saved answer.",
    );
    assert.deepEqual(await readWorkspace(page), latest);
    await other.close();
  });
});

test("a stale new-card draft cannot overwrite a second tab's newly added card", async (t) => {
  await withBrowser(t, async ({ page, context }) => {
    await createArea(page);
    const draft = await draftCard(page, question, answer);
    const other = await context.newPage();
    await other.goto(appUrl);
    await openLibrary(other);
    await addCard(other, "What does a channel carry?", "Values between goroutines.");
    const latest = await waitForWorkspace(
      other,
      (workspace) => workspace?.areas[0]?.cards.length === 1,
    );
    await draft.getByRole("button", { name: "Add card", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Another tab saved a newer workspace" })
      .waitFor();
    assert.equal(await draft.getByLabel("Question", { exact: true }).inputValue(), question);
    assert.equal(await draft.getByLabel("Answer", { exact: true }).inputValue(), answer);
    assert.deepEqual(await readWorkspace(page), latest);
    await other.close();
  });
});

for (const [name, raw, notice] of [
  [
    "malformed JSON",
    "{broken persisted workspace",
    "Saved data could not be decoded and has been left untouched.",
  ],
  [
    "future schema",
    JSON.stringify({ schemaVersion: 999, privateMarker: "preserve-me" }),
    "Saved data uses a newer Recall format. It has been left untouched.",
  ],
  [
    "invalid structure",
    JSON.stringify({ schemaVersion: 1, areas: "invalid" }),
    "Saved data could not be decoded and has been left untouched.",
  ],
]) {
  test(`${name} stays intact across reload, rejected edits and rejected imports`, async (t) => {
    await withBrowser(t, async ({ page }) => {
      await createArea(page);
      await rawSnapshot(page, raw);
      await page.reload();
      await page.getByRole("status").filter({ hasText: notice }).waitFor();
      assert.equal(await rawSnapshot(page), raw);
      await openLibrary(page);
      await page.getByRole("button", { name: "＋ New area", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "New area", exact: true });
      await editor.getByLabel("Area name", { exact: true }).fill("Do not replace corrupt data");
      await editor.getByRole("button", { name: "Create area", exact: true }).click();
      await editor.getByRole("alert").waitFor();
      assert.equal(
        await editor.getByLabel("Area name", { exact: true }).inputValue(),
        "Do not replace corrupt data",
      );
      assert.equal(await rawSnapshot(page), raw);
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.locator("#knowledge-area-import").setInputFiles({
        name: "invalid.json",
        mimeType: "application/json",
        buffer: Buffer.from("not-json"),
      });
      await page
        .getByRole("status")
        .filter({ hasText: "That file is not a valid Knowledge Area JSON document." })
        .waitFor();
      assert.equal(await rawSnapshot(page), raw);
      await page.reload();
      await page.getByRole("status").filter({ hasText: notice }).waitFor();
      assert.equal(await rawSnapshot(page), raw);
    });
  });
}

test("invalid image bytes and empty attachments retain the draft and create no card history", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    const before = await readWorkspace(page);
    const dialog = await draftCard(page, question, answer);
    await dialog.getByText("Card details", { exact: true }).click();
    const attachment = dialog.getByLabel("Attach image or audio (20 MB max)", { exact: true });
    await attachment.setInputFiles({
      name: "fake.png",
      mimeType: "image/png",
      buffer: Buffer.from("not a PNG image"),
    });
    await dialog.getByRole("button", { name: "Add card", exact: true }).click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: "Choose a supported image or audio file. Your draft is preserved." })
      .waitFor();
    assert.deepEqual(await readWorkspace(page), before);
    await attachment.setInputFiles({
      name: "empty.wav",
      mimeType: "audio/wav",
      buffer: Buffer.alloc(0),
    });
    await dialog.getByRole("button", { name: "Add card", exact: true }).click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: "Media must be smaller than 20 MB." })
      .waitFor();
    assert.equal(await dialog.getByLabel("Question", { exact: true }).inputValue(), question);
    assert.equal(await dialog.getByLabel("Answer", { exact: true }).inputValue(), answer);
    assert.deepEqual(await readWorkspace(page), before);
    await attachment.setInputFiles([]);
    await dialog.getByRole("button", { name: "Add card", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const saved = await waitForWorkspace(
      page,
      (workspace) => workspace?.areas[0]?.cards.length === 1,
    );
    assert.equal(saved.areas[0].cards[0].front, question);
    assert.equal(saved.areas[0].cards[0].media?.length ?? 0, 0);
  });
});

test("deleting the last area excludes its cards and notebooks from search and permits recovery", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    await addCard(page, question, answer);
    const before = await readWorkspace(page);
    const notebook = notebookFixture(before.areas[0].id);
    const notebookKey = `recall-knowledge-notebook:${JSON.stringify(["hosted", notebook.areaId])}`;
    await page.evaluate(
      ({ key, notebook }) => localStorage.setItem(key, JSON.stringify(notebook)),
      { key: notebookKey, notebook },
    );
    const search = await openSearch(page, "goroutine");
    await search.getByLabel("Show", { exact: true }).selectOption("material");
    await search.getByText("1 results", { exact: true }).waitFor();
    await search.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByLabel("Actions for Go programming", { exact: true }).click();
    page.once("dialog", (prompt) => prompt.accept());
    await page
      .locator(".area-actions")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    const deleted = await waitForWorkspace(page, (workspace) => workspace?.areas.length === 0);
    assert.deepEqual(deleted.reviewEvents, before.reviewEvents);
    const deletedSearch = await openSearch(page, "goroutine");
    await deletedSearch.getByText("0 results", { exact: true }).waitFor();
    assert.equal(await deletedSearch.getByRole("listitem").count(), 0);
    await deletedSearch.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByText("Deleted cards (1)", { exact: true }).click();
    const recovery = page.getByRole("region", { name: "Deleted card", exact: true });
    await recovery
      .getByRole("button", { name: /· delete$/ })
      .first()
      .click();
    await recovery.getByRole("button", { name: /^Restore (this version|as a new copy)$/ }).click();
    const restored = await waitForWorkspace(
      page,
      (workspace) => workspace?.areas.length === 1 && workspace.areas[0].cards.length === 1,
    );
    assert.equal(restored.areas[0].title, "Go programming");
    assert.equal(restored.areas[0].cards[0].front, question);
    assert.deepEqual(restored.reviewEvents, before.reviewEvents);
    await page.reload();
    await openLibrary(page);
    await cardRow(page, question).waitFor();
    assert.deepEqual(await readWorkspace(page), restored);
  });
});

test("search traps keyboard focus, closes with Escape and restores focus without changing data", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    await addCard(page, question, answer);
    const before = await readWorkspace(page);
    const searchButton = page.getByRole("button", { name: "Search", exact: true });
    const dialog = await openSearch(page, "goroutine");
    const input = dialog.getByLabel("Search", { exact: true });
    await input.focus();
    assert.equal(await input.evaluate((element) => document.activeElement === element), true);
    await input.press("Shift+Tab");
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    assert.equal(await close.evaluate((element) => document.activeElement === element), true);
    await close.press("Tab");
    assert.equal(await input.evaluate((element) => document.activeElement === element), true);
    await input.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await searchButton.evaluate((element) => document.activeElement === element),
      true,
    );
    assert.deepEqual(await readWorkspace(page), before);
  });
});

test("a held cross-tab Web Lock keeps a card draft pending until the durable commit can run", async (t) => {
  await withBrowser(t, async ({ page, context }) => {
    await createArea(page);
    const before = await readWorkspace(page);
    const holder = await context.newPage();
    await holder.goto(appUrl);
    await holder.getByRole("heading", { name: "Today", exact: true }).waitFor();
    await holder.evaluate(
      () =>
        new Promise((acquired) => {
          void navigator.locks.request("recall-local-data", { mode: "exclusive" }, () => {
            acquired(true);
            return new Promise((release) => {
              window.releaseRecallTestLock = release;
            });
          });
        }),
    );
    const draft = await draftCard(page, question, answer);
    await draft.getByRole("button", { name: "Add card", exact: true }).click();
    await draft.getByRole("button", { name: "Saving card…", exact: true }).waitFor();
    assert.deepEqual(await readWorkspace(page), before);
    assert.equal(await draft.getByLabel("Answer", { exact: true }).inputValue(), answer);
    assert.equal(
      await draft.getByRole("button", { name: "Saving card…", exact: true }).isDisabled(),
      true,
    );
    await holder.evaluate(() => {
      window.releaseRecallTestLock();
      delete window.releaseRecallTestLock;
    });
    await draft.waitFor({ state: "hidden" });
    const saved = await waitForWorkspace(
      page,
      (workspace) => workspace?.areas[0]?.cards.length === 1,
    );
    assert.equal(saved.areas[0].cards[0].front, question);
    assert.deepEqual(saved.reviewEvents, before.reviewEvents);
    await holder.close();
  });
});
