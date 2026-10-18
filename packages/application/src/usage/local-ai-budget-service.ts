import { Effect, Schema } from "effect";
import {
  defaultLocalAiUsagePolicy,
  emptyLocalAiUsageState,
  LocalAiUsageStateSchema,
  reserveLocalAiUsage,
  settleLocalAiUsage,
  summarizeLocalAiUsage,
  updateLocalAiUsagePolicy,
  type LocalAiUsageState,
  type LocalAiUsageSnapshot,
  type LocalAiUsageReservation,
  type LocalAiUsageSettlement,
} from "./local-ai-usage";

export type LocalBudgetFailure = { readonly _tag: "LocalBudgetFailure"; readonly message: string };
export type LocalBudgetApi = {
  readonly read: (accountId: string) => Effect.Effect<LocalAiUsageSnapshot, LocalBudgetFailure>;
  readonly setBudget: (input: unknown) => Effect.Effect<LocalAiUsageSnapshot, LocalBudgetFailure>;
};
export const localBudgetFailure = (
  message = "Local AI usage could not be read or saved. Requests are blocked until storage is available.",
): LocalBudgetFailure => ({ _tag: "LocalBudgetFailure", message });
export type LocalBudgetTransaction = <A>(
  update: (
    state: LocalAiUsageState,
  ) => Effect.Effect<{ readonly state: LocalAiUsageState; readonly value: A }, LocalBudgetFailure>,
) => Effect.Effect<A, LocalBudgetFailure>;

/** Storage adapters serialize the complete read / update / write transaction. */
export function createLocalBudgetService(transaction: LocalBudgetTransaction) {
  const snapshot = (state: LocalAiUsageState, accountId: string) =>
    summarizeLocalAiUsage(state, accountId, Date.now()).pipe(
      Effect.mapError((error) => localBudgetFailure(error.message)),
      Effect.map((summary): LocalAiUsageSnapshot => ({
        policy:
          state.policies.find((policy) => policy.accountId === accountId) ??
          defaultLocalAiUsagePolicy(accountId),
        summary,
        entries: state.entries.filter((entry) => entry.accountId === accountId),
      })),
    );
  return {
    read: (accountId: string) =>
      transaction((state) =>
        snapshot(state, accountId).pipe(Effect.map((value) => ({ state, value }))),
      ),
    setBudget: (input: unknown) =>
      transaction((state) =>
        updateLocalAiUsagePolicy(state, input).pipe(
          Effect.mapError((error) => localBudgetFailure(error.message)),
          Effect.flatMap((next) =>
            Schema.decodeUnknown(Schema.Struct({ accountId: Schema.String }))(input).pipe(
              Effect.mapError(() => localBudgetFailure("Invalid budget account.")),
              Effect.flatMap(({ accountId }) => snapshot(next, accountId)),
              Effect.map((value) => ({ state: next, value })),
            ),
          ),
        ),
      ),
    reserve: (input: LocalAiUsageReservation) =>
      transaction((state) =>
        reserveLocalAiUsage(state, input).pipe(
          Effect.mapError((error) =>
            localBudgetFailure(
              error._tag === "LocalAiBudgetExceeded"
                ? `Local ${error.kind} limit reached (${String(error.used)}/${String(error.limit)}). Resets ${new Date(error.resetsAt).toISOString()}.`
                : error.message,
            ),
          ),
          Effect.map((result) => ({ state: result.state, value: result.entry })),
        ),
      ),
    settle: (input: LocalAiUsageSettlement) =>
      transaction((state) =>
        settleLocalAiUsage(state, input).pipe(
          Effect.mapError((error) => localBudgetFailure(error.message)),
          Effect.map((result) => ({ state: result.state, value: undefined })),
        ),
      ),
  };
}
export const decodeLocalBudgetRecord = (raw: string | null) =>
  raw === null
    ? Effect.succeed(emptyLocalAiUsageState())
    : Schema.decodeUnknown(Schema.parseJson(LocalAiUsageStateSchema))(raw).pipe(
        Effect.mapError(() =>
          localBudgetFailure(
            "Saved usage data is invalid. It has been preserved; no budget was reset.",
          ),
        ),
      );

/** Empty means unlimited; zero blocks admissions. No decimals, negatives or exponent syntax. */
export function parseLocalBudgetLimit(value: string): number | null | "invalid" {
  const text = value.trim();
  if (text === "") return null;
  if (!/^\d{1,7}$/.test(text)) return "invalid";
  const count = Number(text);
  return count <= 1_000_000 ? count : "invalid";
}
