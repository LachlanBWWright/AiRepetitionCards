import { Effect } from "effect";

const writes = Effect.runSync(Effect.makeSemaphore(1));
let blocked = false;
let reviewPending = false;
const listeners = new Set<() => void>();

export const setReviewWritePending = (pending: boolean) => {
  reviewPending = pending;
};
export const localWritesBlocked = () => blocked;
export const subscribeLocalWrites = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function blockWrites() {
  blocked = true;
  for (const listener of listeners) listener();
}

/** Serialize this tab's volatile commits; durable study data lives in the account API. */
export const coordinateLocalWrite = <A, E>(
  operation: Effect.Effect<A, E>,
  onBlocked: () => E,
  allowPendingReview = false,
): Effect.Effect<A, E> =>
  writes.withPermits(1)(
    Effect.suspend(() =>
      blocked || (reviewPending && !allowPendingReview) ? Effect.fail(onBlocked()) : operation,
    ),
  );

/** Clear only this tab's volatile working copy. */
export const coordinateLocalErasure = (operation: Effect.Effect<boolean>) =>
  Effect.suspend(() => {
    blockWrites();
    return writes.withPermits(1)(operation);
  });
