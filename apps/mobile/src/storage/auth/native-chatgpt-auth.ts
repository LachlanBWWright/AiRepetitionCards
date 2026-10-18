import { Effect, Either, Schema } from "effect";
import { requireOptionalNativeModule } from "expo";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import { createChatGPTAuth, type ChatGPTAuthFailure } from "./chatgpt-auth";
import { withNativeRequest } from "../native-http";

type NativeChatGPTModule = {
  readonly open: (url: string) => Promise<unknown>;
  readonly start: (state: string) => Promise<unknown>;
  readonly callback: (id: string) => Promise<unknown>;
  readonly stop: (id: string) => Promise<unknown>;
  readonly verify: (
    input: string,
    signature: string,
    modulus: string,
    exponent: string,
    algorithm: string,
  ) => Promise<unknown>;
};
const key = "recall-chatgpt-auth-v1";
const failure = (code: string): ChatGPTAuthFailure => ({ _tag: "ChatGPTAuthFailure", code });
const native = () =>
  Effect.try({
    try: () => requireOptionalNativeModule<NativeChatGPTModule>("RecallChatGPT"),
    catch: () => failure("native-build-required"),
  }).pipe(
    Effect.filterOrFail(
      (value): value is NativeChatGPTModule => value !== null,
      () => failure("native-build-required"),
    ),
  );
const invoke = (action: (module: NativeChatGPTModule) => Promise<unknown>) =>
  native().pipe(
    Effect.flatMap((module) =>
      Effect.tryPromise({
        try: () => action(module),
        catch: () => failure("native-operation-failed"),
      }),
    ),
  );
const reply = <A>(schema: Schema.Schema<A>, raw: unknown) =>
  Effect.gen(function* () {
    const result = Schema.decodeUnknownEither(Schema.Struct({ ok: Schema.Boolean }))(raw);
    if (Either.isLeft(result)) return yield* Effect.fail(failure("invalid-native-response"));
    if (!result.right.ok) {
      const error = Schema.decodeUnknownEither(Schema.Struct({ code: Schema.String }))(raw);
      const known = [
        "cancelled",
        "invalid-state",
        "sign-in-in-progress",
        "callback-listener-unavailable",
        "browser-unavailable",
      ];
      return yield* Effect.fail(
        failure(
          Either.isRight(error) && known.includes(error.right.code)
            ? error.right.code
            : "native-operation-failed",
        ),
      );
    }
    return yield* Schema.decodeUnknown(schema)(raw).pipe(
      Effect.mapError(() => failure("invalid-native-response")),
    );
  });
const base64url = (value: string) =>
  value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decodePart = (value: string) => {
  const encoded = value.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))) as unknown;
};
const Header = Schema.Struct({
  alg: Schema.Literal("RS256", "RS384", "RS512"),
  kid: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
  crit: Schema.optional(Schema.Array(Schema.String)),
  b64: Schema.optional(Schema.Boolean),
});
const Keys = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      kty: Schema.String,
      kid: Schema.optional(Schema.String),
      n: Schema.optional(Schema.String),
      e: Schema.optional(Schema.String),
      alg: Schema.optional(Schema.String),
      use: Schema.optional(Schema.String),
      key_ops: Schema.optional(Schema.Array(Schema.String)),
    }),
  ).pipe(Schema.maxItems(100)),
});

/** Verify with OS cryptography; Hermes does not need a WebCrypto polyfill or a Node runtime. */
export function verifyNativeChatGPTSignature(token: string, jwks: unknown) {
  return Effect.gen(function* () {
    if (token.length > 32000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
      return false;
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) return false;
    const decoded = yield* Effect.try({
      try: () => decodePart(header),
      catch: () => failure("invalid-identity-token"),
    });
    const h = Schema.decodeUnknownEither(Header)(decoded);
    const keys = Schema.decodeUnknownEither(Keys)(jwks);
    if (
      Either.isLeft(h) ||
      Either.isLeft(keys) ||
      h.right.crit !== undefined ||
      h.right.b64 === false
    )
      return false;
    const candidates = keys.right.keys.filter(
      (k) =>
        k.kid === h.right.kid &&
        k.kty === "RSA" &&
        (k.use === undefined || k.use === "sig") &&
        (k.alg === undefined || k.alg === h.right.alg) &&
        (k.key_ops === undefined || k.key_ops.includes("verify")),
    );
    const selected = candidates.length === 1 ? candidates[0] : undefined;
    if (!selected?.n || !selected.e) return false;
    const raw = yield* invoke((module) =>
      module.verify(
        `${header}.${body}`,
        signature,
        selected.n ?? "",
        selected.e ?? "",
        h.right.alg,
      ),
    );
    return yield* Schema.decodeUnknown(Schema.Boolean)(raw).pipe(
      Effect.mapError(() => failure("invalid-native-response")),
    );
  });
}

export const nativeChatGPTAuth = createChatGPTAuth({
  read: () =>
    Effect.tryPromise({
      try: () => SecureStore.getItemAsync(key),
      catch: () => failure("credential-storage-failed"),
    }),
  write: (value) =>
    Effect.tryPromise({
      try: () =>
        SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
      catch: () => failure("credential-storage-failed"),
    }),
  random: () =>
    Effect.try({
      try: () => base64url(btoa(String.fromCharCode(...Crypto.getRandomBytes(32)))),
      catch: () => failure("secure-random-unavailable"),
    }),
  hostId: Crypto.randomUUID,
  challenge: (verifier) =>
    Effect.tryPromise({
      try: async () =>
        base64url(
          await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
            encoding: Crypto.CryptoEncoding.BASE64,
          }),
        ),
      catch: () => failure("secure-random-unavailable"),
    }),
  now: Date.now,
  start: (state) =>
    invoke((module) => module.start(state)).pipe(
      Effect.flatMap((raw) =>
        reply(Schema.Struct({ id: Schema.String, redirectUri: Schema.String }), raw),
      ),
    ),
  callback: (id) =>
    invoke((module) => module.callback(id)).pipe(
      Effect.flatMap((raw) => reply(Schema.Struct({ url: Schema.String }), raw)),
      Effect.map((value) => value.url),
    ),
  stop: (id) => invoke((module) => module.stop(id)).pipe(Effect.asVoid),
  open: (url) =>
    Platform.OS === "ios"
      ? invoke((module) => module.open(url)).pipe(
          Effect.flatMap((raw) => reply(Schema.Struct({ ok: Schema.Boolean }), raw)),
          Effect.asVoid,
        )
      : Effect.tryPromise({
          try: async () => {
            await Linking.openURL(url);
          },
          catch: () => failure("browser-unavailable"),
        }),
  request: (url, form) =>
    Effect.tryPromise({
      try: () =>
        withNativeRequest(
          url,
          {
            method: form ? "POST" : "GET",
            redirect: "error",
            headers: {
              accept: "application/json",
              ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
            },
            ...(form ? { body: new URLSearchParams(form).toString() } : {}),
          },
          async (response) => {
            const value = await response.text();
            return { status: response.status, body: parseProviderJson(value) };
          },
        ),
      catch: () => failure("provider-unavailable"),
    }),
  verifySignature: verifyNativeChatGPTSignature,
});

export const nativeChatGPTAvailable = () =>
  native().pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
export function nativeChatGPTFailureMessage(error: ChatGPTAuthFailure): string {
  switch (error.code) {
    case "native-build-required":
      return "ChatGPT sign-in requires a rebuilt native app. It is unavailable in Expo Go.";
    case "cancelled":
      return "ChatGPT sign-in was cancelled or expired. Keep Recall open during sign-in and try again.";
    case "callback-listener-unavailable":
      return "The device could not receive the ChatGPT sign-in callback. Keep Recall open and retry.";
    case "identity-mismatch":
    case "invalid-identity-token":
      return "ChatGPT could not verify this account. The existing connection was preserved. Sign in again to the saved account.";
    case "session-expired":
    case "sign-in-required":
      return "Your ChatGPT session expired. Sign in again using the saved registration.";
    case "credential-storage-failed":
    case "invalid-stored-session":
      return "The device could not read or save the protected ChatGPT connection. Try again after unlocking the device.";
    case "plan-permission-required":
      return "Enable ChatGPT access and approve plan usage for this account.";
    case "rate-limited":
      return "ChatGPT is rate limited. Wait before trying again.";
    case "account-limit":
      return "This device already has ten saved ChatGPT registrations. Reconnect an existing account.";
    case "sign-in-in-progress":
      return "A ChatGPT sign-in is already running. Finish or cancel it first.";
    case "account-changed":
      return "The selected ChatGPT account changed. Retry with the current account.";
    default:
      return "ChatGPT could not complete this action. Check your connection and try again.";
  }
}

function parseProviderJson(value: string): unknown {
  if (value.length > 256000) return null;
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try({
        try: (): unknown => (value ? JSON.parse(value) : null),
        catch: () => null,
      }),
    ),
  );
  return Either.isRight(parsed) ? parsed.right : null;
}
