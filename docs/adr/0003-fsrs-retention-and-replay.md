# FSRS retention and historical replay

Status: accepted.

## Decision

Pin `ts-fsrs` to `5.4.2`, whose implementation uses FSRS 6. Disable interval fuzzing so identical
inputs produce identical scheduling state. Start with the pinned default weights and a target
retention of 90%; expose a private workspace preference from 70% to 97%.

Scheduling and content import operations receive an explicit timestamp from the platform boundary.
The scheduler never reads the clock. Replay without events requires an explicit initial timestamp;
otherwise it returns `missing-initial-timestamp` through its typed failure channel.

Changing the preference affects future reviews. It does not rewrite events or immediately move
existing due dates. Each new event stores a parameter-set identifier such as
`ts-fsrs-5.4.2-default-r9000`. The integer suffix records retention to four decimal places, matching
the scheduler's effective precision. Existing missing or null identifiers use the pinned 90%
default.

Replay resolves the parameter set on each historical event. An unknown explicit identifier,
invalid review timestamp, or scheduling adapter failure returns a typed Effect error. Sync preserves
the local workspace when replay fails. Scheduler upgrades must add an explicit historical adapter
before accepting their parameter identifiers; they must not reinterpret old identifiers using new
weights.

## Consequences

Preferences stay in the private workspace and its backups, outside portable Knowledge Areas.
Review parameter identifiers travel through the existing review-sync contract. The review log
remains authoritative, and schedule caches can be reconstructed from mixed-retention history.
Parameter fitting is a separate future application operation and is never triggered by an ordinary
review.
