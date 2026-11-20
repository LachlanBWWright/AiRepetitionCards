import assert from "node:assert/strict";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";

async function pendingSource(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open("recall-anki-import-draft", 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const transaction = database.transaction("packages", "readonly");
          const request = transaction.objectStore("packages").get("pending");
          request.onsuccess = () => {
            database.close();
            resolve(request.result?.name ?? null);
          };
          request.onerror = () => {
            database.close();
            reject(request.error);
          };
        };
      }),
  );
}

const packageFile = {
  name: "private-synthetic.apkg",
  mimeType: "application/zip",
  buffer: Buffer.from("This synthetic package deliberately fails validation."),
};

test("Anki source retention is opt-in, survives reload, revalidates and can be discarded", async (t) => {
  await withBrowser(t, async ({ page }) => {
    const url = storyUrl("screens-anki-import--choose-package");
    await page.goto(url);
    await expectVisible(page.getByRole("button", { name: "Choose package", exact: true }));
    const retention = page.getByRole("checkbox");
    assert.equal(await retention.isChecked(), false);
    await page.getByLabel("Choose Anki deck package", { exact: true }).setInputFiles(packageFile);
    await expectVisible(page.getByText("Import couldn’t continue", { exact: true }));
    assert.equal(await pendingSource(page), null);

    await page.reload();
    await expectVisible(page.getByRole("button", { name: "Choose package", exact: true }));
    await page.getByRole("checkbox").check();
    await page.getByLabel("Choose Anki deck package", { exact: true }).setInputFiles(packageFile);
    await expectVisible(page.getByText("Import couldn’t continue", { exact: true }));
    assert.equal(await pendingSource(page), packageFile.name);

    await page.reload();
    await expectVisible(page.getByRole("button", { name: "Resume import", exact: true }));
    await page.getByRole("button", { name: "Resume import", exact: true }).click();
    await expectVisible(page.getByText("Import couldn’t continue", { exact: true }));
    await page.reload();
    await expectVisible(page.getByRole("button", { name: "Discard saved package", exact: true }));
    await page.getByRole("button", { name: "Discard saved package", exact: true }).click();
    assert.equal(await pendingSource(page), null);
    await page.reload();
    await expectVisible(page.getByRole("button", { name: "Choose package", exact: true }));
    assert.equal(await page.getByRole("button", { name: "Resume import", exact: true }).count(), 0);
  });
});

test("device-data erasure removes an opted-in Anki source", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-anki-import--choose-package"));
    await expectVisible(page.getByRole("button", { name: "Choose package", exact: true }));
    await page.getByRole("checkbox").check();
    await page.getByLabel("Choose Anki deck package", { exact: true }).setInputFiles(packageFile);
    await expectVisible(page.getByText("Import couldn’t continue", { exact: true }));
    assert.equal(await pendingSource(page), packageFile.name);
    await page.getByRole("button", { name: "Close Anki import", exact: true }).click();
    await page.getByRole("button", { name: "Clear device data", exact: true }).click();
    await expectVisible(page.getByText("Device data cleared", { exact: true }));
    assert.equal(await pendingSource(page), null);
    await page.reload();
    await expectVisible(page.getByRole("button", { name: "Choose package", exact: true }));
    assert.equal(await page.getByRole("button", { name: "Resume import", exact: true }).count(), 0);
  });
});

test("failed source deletion reports failure and retains the recovery action", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("screens-anki-import--choose-package"));
    await expectVisible(page.getByRole("button", { name: "Choose package", exact: true }));
    await page.getByRole("checkbox").check();
    await page.getByLabel("Choose Anki deck package", { exact: true }).setInputFiles(packageFile);
    await expectVisible(page.getByText("Import couldn’t continue", { exact: true }));
    await page.reload();
    await expectVisible(page.getByRole("button", { name: "Discard saved package", exact: true }));
    await page.evaluate(() => {
      const remove = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (...args) {
        this.transaction.abort();
        return remove.apply(this, args);
      };
    });
    await page.getByRole("button", { name: "Discard saved package", exact: true }).click();
    await expectVisible(page.getByText(/The saved source package could not be removed/));
    assert.equal(await pendingSource(page), packageFile.name);
  });
});
