# ADR 0009: Review sync, sharing, Anki interoperability and rendering

Status: accepted.

## Decision

Reviews are append-only events with causal/device identity and pinned scheduler parameters. Shared deterministic reconciliation rebuilds derived schedules. Content synchronization uses base hashes and explicit conflict acceptance; deletions propagate as tombstones. Platform clocks and ID generation are injected into coordination. See [sync protocol](../sync-protocol.md).

Publications are immutable content snapshots with attribution/licensing. Unlisted tokens are bearer credentials that owners can rotate/revoke. Forks remap content identities and start independent private study state. Upstream comparison shows differences without automatically modifying a learner's fork. Published content never includes personal reviews, schedules or tutor history.

Knowledge Area JSON/ZIP is the native interchange format. Anki import implements the documented supported Basic/Cloze/media subset and records import provenance; it does not adopt Anki's internal model or execute templates. Scheduled review logs can rebuild FSRS history, while cram/reschedule logs and incompatible due semantics are disclosed. Advanced template fidelity, Anki export and collection-replacement semantics remain deferred.

Rich cards use safe text/Cloze and verified image/audio references. Imported HTML is reduced to the allowed representation; scripts, external template code and arbitrary server URL fetching are not supported. ZIP parsing bounds entries, paths, bytes and expansion ratios before content is committed. Interoperability code is independently implemented; copying Anki implementation code requires a separate compatible-license decision.

## Consequences

A copied publication cannot carry another learner's private state. Revoking a link prevents future access but cannot recall downloaded content. Cross-device, hostile archive and rendered-content acceptance remain release gates; source checks alone do not prove them.
