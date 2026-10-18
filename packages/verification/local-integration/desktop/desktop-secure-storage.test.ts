import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  desktopSecretStoreOverride,
  desktopSecureStorageAvailable,
} from "../../../../apps/desktop/src/main/security/desktop-secure-storage.js";

await test("async encryption initializes before Linux backend validation", async () => {
  let initialized = false;
  const available = await Effect.runPromise(
    desktopSecureStorageAvailable(
      {
        isAsyncEncryptionAvailable: () => {
          initialized = true;
          return Promise.resolve(true);
        },
        getSelectedStorageBackend: () => (initialized ? "gnome_libsecret" : "basic_text"),
      },
      "linux",
    ),
  );
  assert.equal(available, true);
});
await test("terminal launches use Secret Service without overriding configured desktops", () => {
  assert.equal(desktopSecretStoreOverride("linux", false, undefined, undefined), "gnome-libsecret");
  assert.equal(desktopSecretStoreOverride("linux", true, undefined, undefined), null);
  assert.equal(desktopSecretStoreOverride("linux", false, "KDE", undefined), null);
  assert.equal(desktopSecretStoreOverride("linux", false, undefined, "gnome"), null);
  assert.equal(desktopSecretStoreOverride("darwin", false, undefined, undefined), null);
});
await test("plaintext and unavailable backends remain rejected", async () => {
  assert.equal(
    await Effect.runPromise(
      desktopSecureStorageAvailable(
        {
          isAsyncEncryptionAvailable: () => Promise.resolve(true),
          getSelectedStorageBackend: () => "basic_text",
        },
        "linux",
      ),
    ),
    false,
  );
  assert.equal(
    await Effect.runPromise(
      desktopSecureStorageAvailable(
        {
          isAsyncEncryptionAvailable: () => Promise.resolve(false),
          getSelectedStorageBackend: () => "gnome_libsecret",
        },
        "linux",
      ),
    ),
    false,
  );
});
await test("non-Linux platforms do not call the Linux backend API", async () => {
  let called = false;
  assert.equal(
    await Effect.runPromise(
      desktopSecureStorageAvailable(
        {
          isAsyncEncryptionAvailable: () => Promise.resolve(true),
          getSelectedStorageBackend: () => {
            called = true;
            return "basic_text";
          },
        },
        "win32",
      ),
    ),
    true,
  );
  assert.equal(called, false);
});
await test("keyring initialization failures are typed", async () => {
  const result = await Effect.runPromise(
    Effect.either(
      desktopSecureStorageAvailable(
        {
          isAsyncEncryptionAvailable: () => Promise.reject(new Error("unavailable")),
          getSelectedStorageBackend: () => "gnome_libsecret",
        },
        "linux",
      ),
    ),
  );
  assert(Either.isLeft(result));
  assert.equal(result.left._tag, "DesktopSecureStorageFailure");
});
