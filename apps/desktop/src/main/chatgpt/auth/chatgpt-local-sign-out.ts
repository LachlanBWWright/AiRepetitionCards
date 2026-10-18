import { Effect, Either } from "effect";
import { fail, object, jsonResponse, issuer } from "../transport/chatgpt-local-protocol";
import type { LocalStore, Reply } from "../transport/chatgpt-local-protocol";

type SignOutDependencies = {
  readonly load: () => Promise<Reply<LocalStore>>;
  readonly save: (store: LocalStore) => Promise<void>;
  readonly request: typeof fetch;
  readonly revocationTimeoutMs?: number;
};

export async function signOutLocalChatGpt(
  clientId: string,
  { load, save, request, revocationTimeoutMs = 5000 }: SignOutDependencies,
): Promise<Reply<{ readonly remoteRevocationConfirmed: boolean }>> {
  const loaded = await load();
  if (loaded._tag === "Failure") return loaded;
  const account = loaded.value.accounts.find((item) => item.clientId === clientId);
  if (!account) return fail("unknown-account");
  // Persist disconnection before contacting the provider. Revocation cannot restore tokens.
  const cleared = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: () =>
          save({ ...loaded.value, activeClientId: null, pendingClientId: null, accounts: [] }),
        catch: () => fail("credential-storage-failed"),
      }),
    ),
  );
  if (Either.isLeft(cleared)) return cleared.left;
  if (!account.credentials) return { _tag: "Success", value: { remoteRevocationConfirmed: true } };
  const token = account.credentials.refreshToken;
  if (!token) return { _tag: "Success", value: { remoteRevocationConfirmed: false } };
  const signal = AbortSignal.timeout(revocationTimeoutMs);
  const revoked = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: async () => {
          const discovery = await request(`${issuer}/.well-known/openid-configuration`, {
            redirect: "error",
            signal,
          });
          const metadata = object(await jsonResponse(discovery));
          if (
            !discovery.ok ||
            metadata?.issuer !== issuer ||
            typeof metadata.revocation_endpoint !== "string"
          )
            return false;
          const endpoint = new URL(metadata.revocation_endpoint);
          if (
            endpoint.origin !== issuer ||
            endpoint.protocol !== "https:" ||
            endpoint.username ||
            endpoint.password ||
            endpoint.hash
          )
            return false;
          const response = await request(endpoint, {
            method: "POST",
            redirect: "error",
            signal,
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token,
              token_type_hint: "refresh_token",
              client_id: clientId,
            }),
          });
          // No provider body is needed; release it without waiting for an error document.
          await response.body?.cancel();
          return response.ok;
        },
        catch: () => false,
      }),
    ),
  );
  return {
    _tag: "Success",
    value: { remoteRevocationConfirmed: Either.isRight(revoked) && revoked.right },
  };
}
