export type SyncStatusInput = {
  readonly storage: "device" | "tab";
  readonly writable: boolean;
  readonly busy: boolean;
  readonly signedIn: boolean;
  readonly online: boolean;
  readonly error: boolean;
  readonly conflict: boolean;
  readonly confirmed: boolean;
  readonly pending: number;
};

/** A server confirmation is distinct from a local save and from an in-flight request. */
export function describeWorkspaceSyncStatus(input: SyncStatusInput) {
  const saved = input.storage === "device" ? "Saved on this device" : "Changes in this tab";
  if (!input.writable)
    return {
      label: "Save needs attention",
      detail: "Keep this view open and resolve the storage error before continuing.",
      attention: true,
    };
  if (input.conflict)
    return {
      label: "Sync needs your decision",
      detail: `${saved}. Conflicting edits have been preserved for review.`,
      attention: true,
    };
  if (input.busy)
    return {
      label: "Syncing…",
      detail: `${saved}. Waiting for account confirmation.`,
      attention: false,
    };
  if (!input.online)
    return {
      label: `Offline · ${saved.toLowerCase()}`,
      detail:
        input.storage === "device"
          ? "Synchronization resumes when this device reconnects."
          : "Keep this tab open until the account confirms your changes.",
      attention: false,
    };
  if (input.error)
    return {
      label: "Sync needs attention",
      detail: `${saved}. Your account has not confirmed all changes. Retry or export a backup.`,
      attention: true,
    };
  if (!input.signedIn)
    return { label: saved, detail: "Sign in to synchronize with your account.", attention: false };
  if (!input.confirmed || input.pending > 0)
    return {
      label: `${saved} · sync pending`,
      detail:
        input.pending > 0
          ? `${String(input.pending)} pending change${input.pending === 1 ? "" : "s"}.`
          : "Waiting for account confirmation.",
      attention: false,
    };
  return {
    label: "Synced with account",
    detail:
      input.storage === "device"
        ? "Your latest changes are saved here and confirmed by the account."
        : "Your latest changes are confirmed by the account.",
    attention: false,
  };
}
