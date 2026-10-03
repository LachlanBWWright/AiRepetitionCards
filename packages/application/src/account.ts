import {
  AccountExportResponseSchema,
  DeleteAccountRequestSchema,
  DeleteAccountResponseSchema,
  type AccountExportResponse,
} from "@recall/contracts";
import { Effect, Schema } from "effect";

export type AccountRequestFailure = {
  readonly _tag: "AccountRequestFailure";
  readonly reason: "not-configured" | "unauthenticated" | "request-failed" | "response-invalid";
};

export type AccountActionFailure =
  | AccountRequestFailure
  | {
      readonly _tag: "AccountConfirmationInvalid";
    };

/** Platform adapters own authentication, transport deadlines and bounded response reading. */
export interface AccountApi {
  readonly exportData: () => Effect.Effect<unknown, AccountRequestFailure>;
  readonly deleteAccount: (confirmation: "DELETE") => Effect.Effect<unknown, AccountRequestFailure>;
}

export function exportAccountData(
  api: AccountApi,
): Effect.Effect<AccountExportResponse, AccountRequestFailure> {
  return api.exportData().pipe(
    Effect.flatMap(Schema.decodeUnknown(AccountExportResponseSchema)),
    Effect.mapError((error): AccountRequestFailure =>
      error._tag === "AccountRequestFailure"
        ? error
        : { _tag: "AccountRequestFailure", reason: "response-invalid" },
    ),
  );
}

/** Local erasure may run only after the server confirms the account was deleted. */
export function deleteAccountData(
  api: AccountApi,
  confirmation: unknown,
): Effect.Effect<void, AccountActionFailure> {
  return Effect.gen(function* () {
    const request = yield* Schema.decodeUnknown(DeleteAccountRequestSchema)({ confirmation }).pipe(
      Effect.mapError(() => ({ _tag: "AccountConfirmationInvalid" }) as const),
    );
    const response = yield* api.deleteAccount(request.confirmation);
    yield* Schema.decodeUnknown(DeleteAccountResponseSchema)(response).pipe(
      Effect.mapError(
        () => ({ _tag: "AccountRequestFailure", reason: "response-invalid" }) as const,
      ),
    );
  });
}
