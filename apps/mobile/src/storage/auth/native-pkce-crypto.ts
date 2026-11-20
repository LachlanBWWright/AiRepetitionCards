import * as Crypto from "expo-crypto";
import { Effect, Schema } from "effect";

/** Hermes needs these WebCrypto primitives before Supabase starts a PKCE flow. */
export function installNativePkceCrypto(): void {
  const existing: unknown = Reflect.get(globalThis, "crypto");
  if (
    typeof existing === "object" &&
    existing !== null &&
    "getRandomValues" in existing &&
    typeof existing.getRandomValues === "function" &&
    "subtle" in existing &&
    typeof existing.subtle === "object" &&
    existing.subtle !== null &&
    "digest" in existing.subtle &&
    typeof existing.subtle.digest === "function"
  )
    return;
  const algorithms = Schema.Literal(
    Crypto.CryptoDigestAlgorithm.SHA1,
    Crypto.CryptoDigestAlgorithm.SHA256,
    Crypto.CryptoDigestAlgorithm.SHA384,
    Crypto.CryptoDigestAlgorithm.SHA512,
  );
  const digest = (algorithm: unknown, data: Parameters<typeof Crypto.digest>[1]) => {
    const name =
      typeof algorithm === "object" && algorithm !== null && "name" in algorithm
        ? algorithm.name
        : algorithm;
    return Effect.runPromise(
      Schema.decodeUnknown(algorithms)(name).pipe(
        Effect.flatMap((selected) =>
          Effect.tryPromise({
            try: () => Crypto.digest(selected, data),
            catch: () => ({ _tag: "NativeDigestFailure" }) as const,
          }),
        ),
      ),
    );
  };
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues: Crypto.getRandomValues,
      randomUUID: Crypto.randomUUID,
      subtle: { digest },
    },
  });
}
