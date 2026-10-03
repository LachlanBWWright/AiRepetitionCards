let stale = false;
const listeners = new Set<() => void>();

export const localSnapshotStale = () => stale;
export const subscribeLocalSnapshot = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** A page must reload to adopt another page's committed workspace. */
export function markLocalSnapshotStale() {
  stale = true;
  for (const listener of listeners) listener();
}
