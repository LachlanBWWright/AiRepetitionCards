import { Effect } from "effect";

type SecureStorage = {
  readonly isAsyncEncryptionAvailable: () => Promise<boolean>;
  readonly getSelectedStorageBackend: () => string;
};

/** Terminal launchers may omit desktop hints; select the real Secret Service provider. */
export function desktopSecretStoreOverride(
  platform: string,
  hasPasswordStoreOverride: boolean,
  desktop: string | undefined,
  session: string | undefined,
): "gnome-libsecret" | null {
  return platform === "linux" && !hasPasswordStoreOverride && !desktop && !session
    ? "gnome-libsecret"
    : null;
}

/** Initialize the async encryptor before inspecting Linux's selected backend. */
export function desktopSecureStorageAvailable(storage: SecureStorage, platform: string) {
  return Effect.tryPromise({
    try: async () => {
      const available = await storage.isAsyncEncryptionAvailable();
      return (
        available && (platform !== "linux" || storage.getSelectedStorageBackend() !== "basic_text")
      );
    },
    catch: () => ({ _tag: "DesktopSecureStorageFailure" }) as const,
  });
}
