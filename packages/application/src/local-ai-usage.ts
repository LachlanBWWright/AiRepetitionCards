import { Effect, Schema } from "effect";

const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200), Schema.pattern(/\S/));
const Count = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.filter(Number.isSafeInteger),
);
const Timestamp = Count.pipe(Schema.lessThanOrEqualTo(8_640_000_000_000_000));
const OptionalCount = Schema.NullOr(Count);
export const LocalAiUsagePolicySchema = Schema.Struct({
  accountId: Id,
  dailyRequestLimit: OptionalCount,
  weeklyRequestLimit: OptionalCount,
  dailyResearchLimit: OptionalCount,
});
export type LocalAiUsagePolicy = typeof LocalAiUsagePolicySchema.Type;
export const LocalAiUsageEntrySchema = Schema.Struct({
  requestId: Id,
  accountId: Id,
  model: Id,
  task: Schema.Literal("tutor", "research"),
  startedAt: Timestamp,
  finishedAt: Schema.NullOr(Timestamp),
  outcome: Schema.Literal("pending", "completed", "failed"),
  inputTokens: OptionalCount,
  outputTokens: OptionalCount,
}).pipe(
  Schema.filter((entry) =>
    entry.outcome === "pending"
      ? entry.finishedAt === null && entry.inputTokens === null && entry.outputTokens === null
      : entry.finishedAt !== null && entry.finishedAt >= entry.startedAt,
  ),
);
export type LocalAiUsageEntry = typeof LocalAiUsageEntrySchema.Type;
export const LocalAiUsageStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  policies: Schema.Array(LocalAiUsagePolicySchema),
  entries: Schema.Array(LocalAiUsageEntrySchema),
}).pipe(
  Schema.filter(
    (state) =>
      new Set(state.policies.map((policy) => policy.accountId)).size === state.policies.length &&
      new Set(state.entries.map((entry) => entry.requestId)).size === state.entries.length,
  ),
);
export type LocalAiUsageState = typeof LocalAiUsageStateSchema.Type;
const PeriodSummarySchema = Schema.Struct({
  requests: Count,
  researchRequests: Count,
  completed: Count,
  failed: Count,
  pending: Count,
  inputTokens: Count,
  outputTokens: Count,
  unknownUsageRequests: Count,
});
export const LocalAiUsageSummarySchema = Schema.Struct({
  daily: PeriodSummarySchema,
  weekly: PeriodSummarySchema,
});
export type LocalAiUsageSummary = typeof LocalAiUsageSummarySchema.Type;
export const LocalAiUsageSnapshotSchema = Schema.Struct({
  policy: LocalAiUsagePolicySchema,
  summary: LocalAiUsageSummarySchema,
  entries: Schema.Array(LocalAiUsageEntrySchema),
}).pipe(
  Schema.filter(
    (snapshot) =>
      snapshot.entries.every((entry) => entry.accountId === snapshot.policy.accountId) &&
      new Set(snapshot.entries.map((entry) => entry.requestId)).size === snapshot.entries.length,
  ),
);
export type LocalAiUsageSnapshot = typeof LocalAiUsageSnapshotSchema.Type;
export const LocalAiUsageReservationSchema = Schema.Struct({
  requestId: Id,
  accountId: Id,
  model: Id,
  task: Schema.Literal("tutor", "research"),
  startedAt: Timestamp,
});
export type LocalAiUsageReservation = typeof LocalAiUsageReservationSchema.Type;
export const LocalAiUsageSettlementSchema = Schema.Struct({
  requestId: Id,
  finishedAt: Timestamp,
  outcome: Schema.Literal("completed", "failed"),
  inputTokens: OptionalCount,
  outputTokens: OptionalCount,
});
export type LocalAiUsageSettlement = typeof LocalAiUsageSettlementSchema.Type;
export type LocalAiUsageInvalid = {
  readonly _tag: "LocalAiUsageInvalid";
  readonly reason:
    | "invalid-state"
    | "invalid-input"
    | "duplicate-request"
    | "unknown-request"
    | "settlement-conflict"
    | "usage-total-overflow";
  readonly message: string;
};
export type LocalAiBudgetExceeded = {
  readonly _tag: "LocalAiBudgetExceeded";
  readonly kind: "daily-requests" | "weekly-requests" | "daily-research";
  readonly accountId: string;
  readonly limit: number;
  readonly used: number;
  readonly resetsAt: number;
};
const invalid = (reason: LocalAiUsageInvalid["reason"], message: string): LocalAiUsageInvalid => ({
  _tag: "LocalAiUsageInvalid",
  reason,
  message,
});
const decodeState = (input: unknown) =>
  Schema.decodeUnknown(LocalAiUsageStateSchema)(input).pipe(
    Effect.mapError(() =>
      invalid(
        "invalid-state",
        "The saved local AI usage history is invalid. Preserve it before recovery; no budget was reset.",
      ),
    ),
  );
export function emptyLocalAiUsageState(): LocalAiUsageState {
  return { version: 1, policies: [], entries: [] };
}
export function defaultLocalAiUsagePolicy(accountId: string): LocalAiUsagePolicy {
  return { accountId, dailyRequestLimit: null, weeklyRequestLimit: null, dailyResearchLimit: null };
}
const dayMs = 86_400_000;
/** Fixed UTC calendar windows; Monday begins the week. All admissions count, including failures. */
function windows(at: number) {
  const dayStart = Math.floor(at / dayMs) * dayMs;
  const weekday = new Date(dayStart).getUTCDay();
  const weekStart = dayStart - ((weekday + 6) % 7) * dayMs;
  return { dayStart, dayEnd: dayStart + dayMs, weekStart, weekEnd: weekStart + 7 * dayMs };
}
function within(entry: LocalAiUsageEntry, accountId: string, start: number, end: number) {
  return entry.accountId === accountId && entry.startedAt >= start && entry.startedAt < end;
}
export function reserveLocalAiUsage(
  stateInput: unknown,
  input: unknown,
): Effect.Effect<
  { readonly state: LocalAiUsageState; readonly entry: LocalAiUsageEntry },
  LocalAiUsageInvalid | LocalAiBudgetExceeded
> {
  return Effect.gen(function* () {
    const state = yield* decodeState(stateInput);
    const request = yield* Schema.decodeUnknown(LocalAiUsageReservationSchema)(input).pipe(
      Effect.mapError(() => invalid("invalid-input", "The local AI request metadata is invalid.")),
    );
    if (state.entries.some((entry) => entry.requestId === request.requestId))
      return yield* Effect.fail(
        invalid("duplicate-request", "This AI request identifier has already been admitted."),
      );
    const policy =
      state.policies.find((item) => item.accountId === request.accountId) ??
      defaultLocalAiUsagePolicy(request.accountId);
    const window = windows(request.startedAt);
    const daily = state.entries.filter((entry) =>
      within(entry, request.accountId, window.dayStart, window.dayEnd),
    );
    const weekly = state.entries.filter((entry) =>
      within(entry, request.accountId, window.weekStart, window.weekEnd),
    );
    const budgets: readonly {
      readonly kind: LocalAiBudgetExceeded["kind"];
      readonly limit: number | null;
      readonly used: number;
      readonly resetsAt: number;
    }[] = [
      {
        kind: "daily-requests",
        limit: policy.dailyRequestLimit,
        used: daily.length,
        resetsAt: window.dayEnd,
      },
      {
        kind: "weekly-requests",
        limit: policy.weeklyRequestLimit,
        used: weekly.length,
        resetsAt: window.weekEnd,
      },
      {
        kind: "daily-research",
        limit: request.task === "research" ? policy.dailyResearchLimit : null,
        used: daily.filter((entry) => entry.task === "research").length,
        resetsAt: window.dayEnd,
      },
    ];
    for (const budget of budgets)
      if (budget.limit !== null && budget.used >= budget.limit)
        return yield* Effect.fail({
          _tag: "LocalAiBudgetExceeded" as const,
          ...budget,
          limit: budget.limit,
          accountId: request.accountId,
        });
    const entry: LocalAiUsageEntry = {
      ...request,
      finishedAt: null,
      outcome: "pending",
      inputTokens: null,
      outputTokens: null,
    };
    return { state: { ...state, entries: [...state.entries, entry] }, entry };
  });
}
export function settleLocalAiUsage(
  stateInput: unknown,
  input: unknown,
): Effect.Effect<
  { readonly state: LocalAiUsageState; readonly entry: LocalAiUsageEntry },
  LocalAiUsageInvalid
> {
  return Effect.gen(function* () {
    const state = yield* decodeState(stateInput);
    const settlement = yield* Schema.decodeUnknown(LocalAiUsageSettlementSchema)(input).pipe(
      Effect.mapError(() =>
        invalid("invalid-input", "The local AI settlement metadata is invalid."),
      ),
    );
    const existing = state.entries.find((entry) => entry.requestId === settlement.requestId);
    if (!existing)
      return yield* Effect.fail(
        invalid("unknown-request", "This AI request was not admitted to the local usage history."),
      );
    if (settlement.finishedAt < existing.startedAt)
      return yield* Effect.fail(
        invalid("invalid-input", "The request completion time precedes its admission."),
      );
    if (existing.outcome !== "pending") {
      if (
        existing.finishedAt === settlement.finishedAt &&
        existing.outcome === settlement.outcome &&
        existing.inputTokens === settlement.inputTokens &&
        existing.outputTokens === settlement.outputTokens
      )
        return { state, entry: existing };
      return yield* Effect.fail(
        invalid(
          "settlement-conflict",
          "The settled AI usage entry cannot be replaced with different usage metadata.",
        ),
      );
    }
    const entry: LocalAiUsageEntry = { ...existing, ...settlement };
    return {
      state: {
        ...state,
        entries: state.entries.map((item) =>
          item.requestId === settlement.requestId ? entry : item,
        ),
      },
      entry,
    };
  });
}
export function updateLocalAiUsagePolicy(
  stateInput: unknown,
  input: unknown,
): Effect.Effect<LocalAiUsageState, LocalAiUsageInvalid> {
  return Effect.gen(function* () {
    const state = yield* decodeState(stateInput);
    const policy = yield* Schema.decodeUnknown(LocalAiUsagePolicySchema)(input).pipe(
      Effect.mapError(() =>
        invalid(
          "invalid-input",
          "Choose nonnegative whole request limits, or leave them unlimited.",
        ),
      ),
    );
    const exists = state.policies.some((item) => item.accountId === policy.accountId);
    return {
      ...state,
      policies: exists
        ? state.policies.map((item) => (item.accountId === policy.accountId ? policy : item))
        : [...state.policies, policy],
    };
  });
}
function summarizePeriod(entries: readonly LocalAiUsageEntry[]): typeof PeriodSummarySchema.Type {
  return {
    requests: entries.length,
    researchRequests: entries.filter((entry) => entry.task === "research").length,
    completed: entries.filter((entry) => entry.outcome === "completed").length,
    failed: entries.filter((entry) => entry.outcome === "failed").length,
    pending: entries.filter((entry) => entry.outcome === "pending").length,
    inputTokens: entries.reduce((total, entry) => total + (entry.inputTokens ?? 0), 0),
    outputTokens: entries.reduce((total, entry) => total + (entry.outputTokens ?? 0), 0),
    unknownUsageRequests: entries.filter(
      (entry) => entry.inputTokens === null || entry.outputTokens === null,
    ).length,
  };
}
/** Known token totals are informational; missing provider usage is disclosed, never invented. */
export function summarizeLocalAiUsage(
  stateInput: unknown,
  accountInput: unknown,
  nowInput: unknown,
): Effect.Effect<LocalAiUsageSummary, LocalAiUsageInvalid> {
  return Effect.gen(function* () {
    const state = yield* decodeState(stateInput);
    const accountId = yield* Schema.decodeUnknown(Id)(accountInput).pipe(
      Effect.mapError(() =>
        invalid("invalid-input", "Choose a valid local AI account identifier."),
      ),
    );
    const now = yield* Schema.decodeUnknown(Timestamp)(nowInput).pipe(
      Effect.mapError(() =>
        invalid("invalid-input", "The local AI usage summary time is invalid."),
      ),
    );
    const window = windows(now);
    return yield* Schema.decodeUnknown(LocalAiUsageSummarySchema)({
      daily: summarizePeriod(
        state.entries.filter((entry) => within(entry, accountId, window.dayStart, window.dayEnd)),
      ),
      weekly: summarizePeriod(
        state.entries.filter((entry) => within(entry, accountId, window.weekStart, window.weekEnd)),
      ),
    }).pipe(
      Effect.mapError(() =>
        invalid(
          "usage-total-overflow",
          "The recorded usage exceeds safe numeric totals. Preserve the usage history before recovery.",
        ),
      ),
    );
  });
}
