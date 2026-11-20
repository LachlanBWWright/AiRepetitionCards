import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createChatGptCallbackHandler } from "../../../../apps/desktop/src/main/chatgpt/auth/chatgpt-callback-handler";

await test("desktop callback serves a private branded page and consumes a valid callback once", async () => {
  const callbacks: URL[] = [];
  const server = createServer(
    createChatGptCallbackHandler("test-state", (url) => callbacks.push(url)),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${String(address.port)}`;
    for (const path of [
      "/auth/callback?state=wrong&code=test-code",
      "/auth/callback?state=test-state&state=test-state&code=test-code",
      "/wrong?state=test-state",
    ]) {
      const invalid = await fetch(`${origin}${path}`);
      assert.equal(invalid.status, 400);
      assert.match(await invalid.text(), /This sign-in link isn’t valid/);
      assert.equal(callbacks.length, 0);
    }
    const path = "/auth/callback?state=test-state&code=test-code&client_id=test-client";
    const response = await fetch(`${origin}${path}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(html, /Continue in Recall/);
    assert.match(html, /Check the app to confirm/);
    assert.match(html, /history\.replaceState/);
    assert.doesNotMatch(html, /test-code|test-state|test-client|https?:\/\//);
    const policy = response.headers.get("content-security-policy") ?? "";
    assert.match(policy, /default-src 'none'/);
    for (const tag of ["script", "style"]) {
      const content = html.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
      assert.ok(content);
      assert.ok(
        policy.includes(`'sha256-${createHash("sha256").update(content).digest("base64")}'`),
      );
    }
    assert.equal(callbacks[0]?.searchParams.get("code"), "test-code");
    assert.equal((await fetch(`${origin}${path}`)).status, 400);
    assert.equal(callbacks.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});

await test("desktop callback distinguishes declined consent from provider errors without reflecting them", async () => {
  for (const error of ["access_denied", "provider_error"]) {
    const callbacks: URL[] = [];
    const server = createServer(
      createChatGptCallbackHandler("test-state", (url) => callbacks.push(url)),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const response = await fetch(
        `http://127.0.0.1:${String(address.port)}/auth/callback?state=test-state&error=${error}&error_description=private-provider-detail`,
      );
      const html = await response.text();
      assert.match(
        html,
        error === "access_denied" ? /Sign-in cancelled/ : /start a new ChatGPT sign-in/,
      );
      assert.doesNotMatch(html, /private-provider-detail|access_denied|provider_error/);
      assert.equal(callbacks.length, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    }
  }
});
