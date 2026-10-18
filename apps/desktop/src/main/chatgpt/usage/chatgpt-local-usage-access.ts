import {
  defaultLocalAiUsagePolicy,
  LocalAiUsageStateSchema,
  summarizeLocalAiUsage,
} from "@recall/application";
import { Effect } from "effect";
import type { LocalStore } from "../transport/chatgpt-local-protocol";

export function createChatGptLocalUsageAccess(dependencies: {
  readonly read: () => Effect.Effect<typeof LocalAiUsageStateSchema.Type, unknown>;
  readonly load: () => Promise<
    { readonly _tag: "Success"; readonly value: LocalStore } | { readonly _tag: "Failure" }
  >;
}) {
  const usageSnapshot = (accountId: string) =>
    Effect.gen(function* () {
      const state = yield* dependencies.read();
      const summary = yield* summarizeLocalAiUsage(state, accountId, Date.now());
      return {
        policy:
          state.policies.find((policy) => policy.accountId === accountId) ??
          defaultLocalAiUsagePolicy(accountId),
        summary,
        entries: state.entries.filter((entry) => entry.accountId === accountId),
      };
    });

  const usageAccount = async (clientId: string) => {
    const loaded = await dependencies.load();
    return loaded._tag === "Success" &&
      loaded.value.activeClientId === clientId &&
      loaded.value.accounts.some(
        (account) => account.clientId === clientId && account.credentials !== null,
      )
      ? { _tag: "Success" as const, value: true as const }
      : { _tag: "Failure" as const, code: "account-changed" };
  };

  return { usageSnapshot, usageAccount } as const;
}
