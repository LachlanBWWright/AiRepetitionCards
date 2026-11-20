import assert from "node:assert/strict";
import { test, expectVisible, storyUrl, withBrowser } from "./helpers.mjs";
const owner = "00000000-0000-4000-8000-000000000007";
async function setup(page, available = true) {
  await page.addInitScript(
    ({ owner, available }) => {
      window.managedAiTest = { owner, requests: [] };
      const request = async (input) => {
        const currentOwner = window.managedAiTest.owner;
        const status = {
          schemaVersion: 1,
          accountId: currentOwner,
          available,
          dailyLimitMicrousd: 1000000,
          usedMicrousd: 0,
          requestLimit: 30,
          requestsUsed: 0,
          expiresAt: null,
        };
        const result = {
          question: "Membranes control transport.",
          objectiveId: null,
          teachingIntent: "Explain",
        };
        const response = {
          action: "question",
          sessionId: "00000000-0000-4000-8000-000000000099",
          result,
        };
        const body =
          input.path === "/api/v1/ai/capabilities" ? status : { schemaVersion: 1, response };
        if (input.path !== "/api/v1/ai/capabilities") window.managedAiTest.requests.push(input);
        return { _tag: "Success", value: { status: 200, body: JSON.stringify(body) } };
      };
      const getStatus = async () => ({
        _tag: "Success",
        value: { ownerId: window.managedAiTest.owner, email: "fixture@example.test" },
      });
      window.recallDesktop = { auth: { getStatus }, api: { request } };
    },
    { owner, available },
  );
  await page.goto(storyUrl("screens-ai-funding--account-scoped"));
  await expectVisible(page.getByText(`Recall account: ${owner}`, { exact: true }));
}
async function selectManaged(page) {
  await page.getByRole("combobox", { name: "Who provides your AI access?" }).click();
  await page.getByRole("option", { name: "Recall managed AI", exact: true }).click();
  await expectVisible(page.getByText("Selected access: managed", { exact: true }));
}
test("managed AI requires explicit choice, persists per account, and forwards funding identity", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await setup(page);
    assert.equal(
      await page.getByRole("button", { name: "Ask a question", exact: true }).isDisabled(),
      true,
    );
    await selectManaged(page);
    await page.getByRole("button", { name: "Ask a question", exact: true }).click();
    await expectVisible(page.getByText("Managed answer received", { exact: true }));
    const calls = await page.evaluate(() => window.managedAiTest.requests);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].aiFunding, "managed");
    assert.equal(calls[0].expectedOwnerId, owner);
    assert.match(calls[0].aiRequestId, /^[0-9a-f-]{36}$/);
    await page.reload();
    await expectVisible(page.getByText("Selected access: managed", { exact: true }));
    await expectVisible(page.getByText(`Conversation scope: managed:${owner}`, { exact: true }));
  });
});
test("switching Recall accounts does not inherit managed funding or conversations", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await setup(page);
    await selectManaged(page);
    const nextOwner = "00000000-0000-4000-8000-000000000008";
    await page.evaluate((value) => {
      window.managedAiTest.owner = value;
      window.dispatchEvent(new Event("focus"));
    }, nextOwner);
    await expectVisible(page.getByText(`Recall account: ${nextOwner}`, { exact: true }));
    await expectVisible(page.getByText("Selected access: byo", { exact: true }));
    assert.equal(
      await page.getByRole("button", { name: "Ask a question", exact: true }).isDisabled(),
      true,
    );
    assert.equal(await page.evaluate(() => window.managedAiTest.requests.length), 0);
  });
});
test("managed selection cannot bypass a denied allowance", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await setup(page, false);
    await selectManaged(page);
    assert.equal(
      await page.getByRole("button", { name: "Ask a question", exact: true }).isDisabled(),
      true,
    );
    assert.equal(await page.evaluate(() => window.managedAiTest.requests.length), 0);
  });
});
