import assert from "node:assert/strict";
import { test, withBrowser } from "./helpers.mjs";
import {
  addCard,
  createArea,
  notebookFixture,
  openLibrary,
  readWorkspace,
} from "./workflow-fixtures.mjs";

async function openSearch(page) {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search", exact: true });
  await dialog.waitFor();
  await dialog
    .getByText("Loading saved materials and discussions…", { exact: true })
    .waitFor({ state: "hidden" });
  return dialog;
}

async function seedNotebook(page, namespace, notebook) {
  await page.evaluate(
    ({ namespace, notebook }) => {
      localStorage.setItem(
        `recall-knowledge-notebook:${JSON.stringify([namespace, notebook.areaId])}`,
        JSON.stringify(notebook),
      );
    },
    { namespace, notebook },
  );
}

test("global search finds saved notebook content, filters kinds, and opens the matching card", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    await addCard(
      page,
      "What is a goroutine?",
      "A lightweight concurrent execution managed by Go.",
    );
    const workspace = await readWorkspace(page);
    await seedNotebook(page, "hosted", notebookFixture(workspace.areas[0].id));
    await page.reload();
    await openLibrary(page);
    const dialog = await openSearch(page);
    await dialog.getByLabel("Search", { exact: true }).fill("goroutine");
    // Seeing all six kinds also proves that the real notebook adapter accepted the seeded schema.
    for (const kind of ["card", "concept", "material", "passage", "conversation", "suggestion"]) {
      await dialog.getByLabel("Show", { exact: true }).selectOption(kind);
      await dialog.getByText("1 results", { exact: true }).waitFor();
      assert.equal(await dialog.getByRole("listitem").count(), 1, `${kind} must be searchable`);
    }
    await dialog.getByLabel("Show", { exact: true }).selectOption("card");
    await dialog.getByRole("button", { name: /What is a goroutine\?/ }).click();
    const editor = page.getByRole("dialog", { name: "Edit card", exact: true });
    await editor.waitFor();
    assert.equal(
      await editor.getByLabel("Question", { exact: true }).inputValue(),
      "What is a goroutine?",
    );
    assert.equal(
      await editor.getByLabel("Answer", { exact: true }).inputValue(),
      "A lightweight concurrent execution managed by Go.",
    );
    assert.equal(await dialog.count(), 0);
    await editor.getByRole("button", { name: "Close card editor", exact: true }).click();
    const suggestions = await openSearch(page);
    await suggestions.getByLabel("Search", { exact: true }).fill("goroutine");
    await suggestions.getByLabel("Show", { exact: true }).selectOption("suggestion");
    await suggestions.getByRole("button", { name: /How are goroutines multiplexed\?/ }).click();
    await page.getByRole("heading", { name: "Tutor", exact: true }).waitFor();
    await page.getByRole("button", { name: "Review suggestions", exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Review suggestions", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByText("How are goroutines multiplexed?", { exact: true }).waitFor();
  });
});

test("search accepts whitespace and literal markup without mutation and reloads persisted results", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    await addCard(
      page,
      "<script>globalThis.searchInjected = true</script>",
      "Literal markup is study text.",
    );
    const before = await readWorkspace(page);
    const dialog = await openSearch(page);
    await dialog.getByLabel("Search", { exact: true }).fill("   ");
    await dialog
      .getByText("Search your library, study materials and saved tutor discussions.", {
        exact: true,
      })
      .waitFor();
    assert.equal(await dialog.getByRole("listitem").count(), 0);
    await dialog.getByLabel("Search", { exact: true }).fill("script");
    await dialog.getByLabel("Show", { exact: true }).selectOption("card");
    await dialog.getByText("1 results", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => Object.hasOwn(globalThis, "searchInjected")), false);
    await dialog.getByLabel("Search", { exact: true }).fill("unmatched-unique-phrase-918273");
    await dialog.getByText("0 results", { exact: true }).waitFor();
    await page.reload();
    await openLibrary(page);
    const reloaded = await openSearch(page);
    await reloaded.getByLabel("Search", { exact: true }).fill("literal markup");
    await reloaded.getByText("1 results", { exact: true }).waitFor();
    assert.deepEqual(await readWorkspace(page), before);
  });
});

test("unreadable source notebooks are preserved and another account notebook stays private", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    await addCard(page, "What is a goroutine?", "A concurrent execution.");
    const workspace = await readWorkspace(page);
    const areaId = workspace.areas[0].id;
    const raw = "{invalid notebook JSON";
    const corruptKey = `recall-knowledge-notebook:${JSON.stringify(["hosted", areaId])}`;
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: corruptKey, raw });
    await seedNotebook(page, "chatgpt:another-account", notebookFixture(areaId));
    const dialog = await openSearch(page);
    await dialog
      .getByText("1 saved notebooks could not be read. Their data has been preserved.", {
        exact: true,
      })
      .waitFor();
    await dialog.getByLabel("Search", { exact: true }).fill("goroutine");
    await dialog.getByLabel("Show", { exact: true }).selectOption("material");
    await dialog.getByText("0 results", { exact: true }).waitFor();
    await dialog.getByLabel("Show", { exact: true }).selectOption("card");
    await dialog.getByText("1 results", { exact: true }).waitFor();
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), corruptKey), raw);
    assert.deepEqual(await readWorkspace(page), workspace);
  });
});

test("a source passage search opens study materials without generating or saving cards", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await createArea(page);
    const workspace = await readWorkspace(page);
    await seedNotebook(page, "hosted", notebookFixture(workspace.areas[0].id));
    await page.reload();
    await openLibrary(page);
    const dialog = await openSearch(page);
    await dialog.getByLabel("Search", { exact: true }).fill("concurrently");
    await dialog.getByLabel("Show", { exact: true }).selectOption("passage");
    await dialog.getByText("1 results", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: /Goroutine execution/ }).click();
    await page.getByRole("heading", { name: "Tutor", exact: true }).waitFor();
    const materials = page.getByRole("button", { name: "Study materials", exact: true });
    await materials.waitFor();
    assert.equal(await materials.getAttribute("aria-pressed"), "true");
    await page
      .getByText("A goroutine runs concurrently with other goroutines.", { exact: true })
      .waitFor();
    assert.deepEqual(await readWorkspace(page), workspace);
  });
});
