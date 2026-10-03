import { Effect } from "effect";
import type { RecallSupabaseClient } from "./client";

export type AccountDeletionError =
  { readonly _tag: "AccountDataEraseFailed" } | { readonly _tag: "AccountIdentityDeleteFailed" };

/** Erase the authenticated owner's application data, then delete their auth identity. */
export function deleteAccount(
  admin: RecallSupabaseClient,
  userId: string,
): Effect.Effect<void, AccountDeletionError> {
  const erase = Effect.tryPromise({
    try: () => admin.rpc("erase_account_data", { p_user_id: userId }),
    catch: () => ({ _tag: "AccountDataEraseFailed" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result.error === null && result.data
        ? Effect.void
        : Effect.fail({ _tag: "AccountDataEraseFailed" } as const),
    ),
  );
  const deleteIdentity = Effect.tryPromise({
    try: () => admin.auth.admin.deleteUser(userId, false),
    catch: () => ({ _tag: "AccountIdentityDeleteFailed" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result.error === null
        ? Effect.void
        : Effect.fail({ _tag: "AccountIdentityDeleteFailed" } as const),
    ),
  );
  return erase.pipe(Effect.andThen(deleteIdentity));
}
