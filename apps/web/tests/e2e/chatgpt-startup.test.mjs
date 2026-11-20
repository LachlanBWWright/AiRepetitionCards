import assert from "node:assert/strict";
import { test, expectVisible, storyUrl, withBrowser } from "./helpers.mjs";

async function mockDesktop(page, signedIn) {
  await page.addInitScript((initiallySignedIn) => {
    let signedIn = initiallySignedIn;
    const calls = { status: 0, models: 0, signIn: 0 };
    window.chatGPTStartupCalls = calls;
    window.recallDesktop = {
      chatgpt: {
        status: async () => {
          calls.status += 1;
          const account = {
            clientId: "saved-client",
            label: "ChatGPT",
            email: null,
            signedIn,
            planEnabled: signedIn,
          };
          const value = {
            enabled: true,
            activeClientId: signedIn ? "saved-client" : null,
            accounts: [account],
          };
          return { _tag: "Success", value };
        },
        models: async () => {
          calls.models += 1;
          return { _tag: "Success", value: [{ slug: "study-model", displayName: "Study model" }] };
        },
        signIn: async () => {
          calls.signIn += 1;
          signedIn = true;
          return { _tag: "Success", value: null };
        },
      },
    };
  }, signedIn);
}

test("saved ChatGPT connections warm up before any AI panel is opened", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await mockDesktop(page, true);
    await page.goto(storyUrl("screens-desktop-chatgpt-startup--background-restoration"));
    await expectVisible(page.getByText("Background connection ready", { exact: true }));
    assert.equal(await page.getByRole("region", { name: /AI panel/ }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.chatGPTStartupCalls), {
      status: 2,
      models: 1,
      signIn: 0,
    });
    await page.getByRole("button", { name: "Open AI panel", exact: true }).click();
    await expectVisible(page.getByText("ChatGPT ready for requests", { exact: true }));
    await page.getByRole("button", { name: "Open AI panel", exact: true }).click();
    assert.equal(await page.getByText("ChatGPT ready for requests", { exact: true }).count(), 2);
    assert.equal(
      await page.getByRole("dialog", { name: "ChatGPT connected", exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "Close AI panels", exact: true }).click();
    await page.getByRole("button", { name: "Open AI panel", exact: true }).click();
    await expectVisible(page.getByText("Selected model: study-model", { exact: true }));
    assert.deepEqual(await page.evaluate(() => window.chatGPTStartupCalls), {
      status: 2,
      models: 1,
      signIn: 0,
    });
  });
});

test("only an explicit ChatGPT sign-in shows the connected confirmation", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await mockDesktop(page, false);
    await page.goto(storyUrl("screens-desktop-chatgpt-startup--background-restoration"));
    await expectVisible(page.getByText("ChatGPT not connected", { exact: true }));
    assert.deepEqual(await page.evaluate(() => window.chatGPTStartupCalls), {
      status: 1,
      models: 0,
      signIn: 0,
    });
    await page.getByRole("button", { name: "Open AI panel", exact: true }).click();
    await page.getByRole("button", { name: "Sign in with ChatGPT", exact: true }).click();
    const welcome = page.getByRole("dialog", { name: "ChatGPT connected", exact: true });
    await expectVisible(welcome);
    await welcome.getByRole("button", { name: "Got it", exact: true }).click();
    await page.getByRole("button", { name: "Close AI panels", exact: true }).click();
    await page.getByRole("button", { name: "Open AI panel", exact: true }).click();
    await expectVisible(page.getByText("ChatGPT ready for requests", { exact: true }));
    assert.equal(await welcome.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.chatGPTStartupCalls), {
      status: 3,
      models: 1,
      signIn: 1,
    });
  });
});

test("returning online rechecks the saved connection without opening an AI panel", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await mockDesktop(page, true);
    await page.goto(storyUrl("screens-desktop-chatgpt-startup--background-restoration"));
    await expectVisible(page.getByText("Background connection ready", { exact: true }));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(() => window.chatGPTStartupCalls.status === 4);
    await expectVisible(page.getByText("Background connection ready", { exact: true }));
    assert.equal(await page.getByRole("region", { name: /AI panel/ }).count(), 0);
    assert.equal(
      await page.getByRole("dialog", { name: "ChatGPT connected", exact: true }).count(),
      0,
    );
    assert.deepEqual(await page.evaluate(() => window.chatGPTStartupCalls), {
      status: 4,
      models: 2,
      signIn: 0,
    });
  });
});
