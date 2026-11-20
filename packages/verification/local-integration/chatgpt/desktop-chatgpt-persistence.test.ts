import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatGptLocalAccounts } from "../../../../apps/desktop/src/main/chatgpt/auth/chatgpt-local-accounts";
import type {
  LocalStore,
  Reply,
} from "../../../../apps/desktop/src/main/chatgpt/transport/chatgpt-local-protocol";

const initial: LocalStore = {
  hostId: "test-host",
  activeClientId: "test-client",
  accounts: [
    {
      clientId: "test-client",
      label: "ChatGPT account",
      subject: "test-subject",
      email: null,
      credentials: {
        accessToken: "test-access",
        refreshToken: "test-refresh",
        idToken: "test-id",
        expiresAt: 1000,
        scopes: ["chatgpt.tokens.use.direct"],
      },
    },
  ],
};

// Fake encryption isolates the real file/cache workflow from the host keyring.
function session(credentialPath: string) {
  let stored: LocalStore | null = null;
  return createChatGptLocalAccounts({
    credentialPath,
    secureAvailable: () => Promise.resolve(true),
    protect: <T>(operation: () => Promise<Reply<T>>) => operation(),
    getStore: () => stored,
    setStore: (next) => {
      stored = next;
    },
    encrypt: (value) => Promise.resolve(Buffer.from(value)),
    decrypt: (value) => Promise.resolve({ result: value.toString(), shouldReEncrypt: false }),
  });
}

await test("a restarted desktop persists credential updates to an unchanged saved account", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recall-chatgpt-persistence-"));
  try {
    const path = join(directory, "credentials.enc");
    await session(path).save(initial);
    const restarted = session(path);
    assert.deepEqual(await restarted.load(), { _tag: "Success", value: initial });
    const account = initial.accounts[0];
    assert.ok(account?.credentials);
    const renewed = {
      ...account,
      credentials: { ...account.credentials, refreshToken: "test-replacement" },
    };
    await restarted.update(renewed);
    const reloaded = await session(path).load();
    assert.equal(reloaded._tag, "Success");
    assert.equal(reloaded.value.accounts[0]?.credentials?.refreshToken, "test-replacement");
    assert.equal(reloaded.value.activeClientId, initial.activeClientId);
    assert.equal(reloaded.value.hostId, initial.hostId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
