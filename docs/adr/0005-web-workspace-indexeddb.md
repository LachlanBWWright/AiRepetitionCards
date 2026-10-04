# ADR 0005: IndexedDB web workspace persistence

- Status: accepted
- Date: 2026-10-03

## Decision

The browser implementation of `WorkspaceStore` uses the `recall-workspace` IndexedDB database and its `snapshots` store. The existing Electron workspace IPC adapter continues to take precedence when available. Application decoding and serialization remain independent of either platform.

Reads inspect the workspace inside a read/write transaction, allowing an absent IndexedDB snapshot to adopt the old `recall-workspace-v1` localStorage value atomically. Legacy content is validated with the canonical workspace parser before persistence. Invalid JSON, invalid shape and unsupported versions are returned intact to application decoding and remain saved for recovery. A corrupt IndexedDB record of another storage type returns a typed storage failure.

Writes validate both the replacement and any existing nonempty snapshot. Invalid or newer saved state requires explicit reset before replacement. The old localStorage value is removed only after the transaction commits, and only if another tab has not changed it. Failed transactions leave the old value available. Explicit reset stores a durable empty marker so a leftover legacy value cannot be adopted again; failure to remove that legacy value is reported as a cleanup failure.

## Consequences

Workspace persistence is asynchronous and no longer limited by synchronous localStorage writes. IndexedDB unavailability, blocked upgrades and aborted transactions use `LocalStoreFailure`; the app must display recovery controls rather than quietly start a new writable cache. Workspace and media use separate databases, without claiming an atomic transaction across both databases. The optional paired-store commit capability acquires the existing local-write coordinator once around media listing, writes, workspace compare-and-swap, and rollback. Its inner operations use raw adapters rather than reacquiring the nonreentrant lock; rollback never reads or adopts a workspace baseline. Other tabs and erasure cannot interleave during this commit, so rollback may safely remove only assets absent at its start.

Standalone media batches and stores without paired coordination retain successful writes after uncertain failure: another writer may already depend on them. Retry can reuse those assets. Abandoned operations can leave unreferenced local assets, removed by explicit local-data erasure. Adapters must opt into paired rollback only when their coordinator excludes every competing local writer and erasure for the entire operation.

Electron's supported single renderer uses the same local coordinator. Native composition implements the paired capability with its existing local-write lane and places standalone media mutations on that lane too. Queued mutations capture the workspace lifetime generation; reset and account deletion pause writes, invalidate old operations, and clear both raw stores under the same lane. Inner paired writes check the lifetime fence, while rollback and explicit cleanup can finish without reacquiring the lane or being blocked by the paused-write fence.

No browser runtime validation was performed for this change, following the current implementation-first instruction. Cross-tab races, storage quotas and browser lifecycle behavior remain runtime validation items.
