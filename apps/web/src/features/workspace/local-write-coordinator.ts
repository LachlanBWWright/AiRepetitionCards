import { Effect, Either, Schema } from "effect";
import { localSnapshotStale } from "./local-snapshot-status";

const writes = Effect.runSync(Effect.makeSemaphore(1));
const lockName = "recall-local-data";
const fenceKey = "recall-local-data-epoch";
const FenceSchema = Schema.Struct({
  epoch: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  erasing: Schema.Boolean,
});
type Fence = typeof FenceSchema.Type;
let sessionEpoch: number | undefined;
let blocked = false;
let reviewPending = false;
export const setReviewWritePending = (pending: boolean) => {
  reviewPending = pending;
};
let listening = false;
const listeners = new Set<() => void>();

function blockWrites() {
  blocked = true;
  for (const listener of listeners) listener();
}

export const localWritesBlocked = () => blocked;
export const subscribeLocalWrites = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function desktopRuntime() {
  return typeof window !== "undefined" && window.recallDesktop !== undefined;
}

function readFence(): Fence | null {
  const read = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => {
          const raw = window.localStorage.getItem(fenceKey);
          return raw === null ? { epoch: 0, erasing: false } : (JSON.parse(raw) as unknown);
        },
        catch: () => null,
      }).pipe(Effect.flatMap(Schema.decodeUnknown(FenceSchema))),
    ),
  );
  return Either.isRight(read) && Number.isSafeInteger(read.right.epoch) ? read.right : null;
}

function writeFence(fence: Fence): boolean {
  return Either.isRight(
    Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => window.localStorage.setItem(fenceKey, JSON.stringify(fence)),
          catch: () => null,
        }),
      ),
    ),
  );
}

function listenForErasure() {
  if (listening) return;
  listening = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== fenceKey && event.key !== null) return;
    const fence = readFence();
    if (!fence || fence.erasing || (sessionEpoch !== undefined && fence.epoch !== sessionEpoch))
      blockWrites();
  });
}

function currentSessionMayWrite(): boolean {
  listenForErasure();
  const fence = readFence();
  if (!fence || fence.erasing || blocked) {
    blockWrites();
    return false;
  }
  sessionEpoch ??= fence.epoch;
  if (sessionEpoch !== fence.epoch) {
    blockWrites();
    return false;
  }
  // Verify storage is writable before admitting a session that may later erase data.
  if (!writeFence(fence)) {
    blockWrites();
    return false;
  }
  return true;
}

function withBrowserLock<A, E>(
  operation: Effect.Effect<A, E>,
  onUnavailable: () => E,
): Effect.Effect<A, E> {
  return Effect.tryPromise({
    try: async () =>
      await window.navigator.locks.request(lockName, { mode: "exclusive" }, () =>
        Effect.runPromise(Effect.either(operation)),
      ),
    catch: onUnavailable,
  }).pipe(Effect.flatMap((result) => result));
}

/** Web writes and legacy-migrating reads share one exclusive lock across tabs. */
export const coordinateLocalWrite = <A, E>(
  operation: Effect.Effect<A, E>,
  onBlocked: () => E,
  allowPendingReview = false,
): Effect.Effect<A, E> =>
  writes.withPermits(1)(
    Effect.suspend(() => {
      if (reviewPending && !allowPendingReview) return Effect.fail(onBlocked());
      if (desktopRuntime()) return blocked ? Effect.fail(onBlocked()) : operation;
      if (localSnapshotStale()) return Effect.fail(onBlocked());
      if (typeof window === "undefined" || !window.navigator.locks) {
        blockWrites();
        return Effect.fail(onBlocked());
      }
      return withBrowserLock(
        Effect.suspend(() =>
          currentSessionMayWrite() && !localSnapshotStale() ? operation : Effect.fail(onBlocked()),
        ),
        onBlocked,
      );
    }),
  );

/** Advance a persistent fence before clearing. Failed cleanup stays fenced until retry. */
export const coordinateLocalErasure = (operation: Effect.Effect<boolean>) =>
  Effect.suspend(() => {
    blockWrites();
    return writes.withPermits(1)(
      Effect.suspend(() => {
        if (desktopRuntime()) return operation;
        if (typeof window === "undefined" || !window.navigator.locks) return Effect.succeed(false);
        return withBrowserLock(
          Effect.gen(function* () {
            const previous = readFence();
            if (!previous || previous.epoch >= Number.MAX_SAFE_INTEGER) return false;
            const fence: Fence = { epoch: previous.epoch + 1, erasing: true };
            if (!writeFence(fence)) return false;
            const cleared = yield* operation;
            return cleared && writeFence({ ...fence, erasing: false });
          }),
          () => ({ _tag: "LocalErasureLockUnavailable" }) as const,
        ).pipe(Effect.orElseSucceed(() => false));
      }),
    );
  });
