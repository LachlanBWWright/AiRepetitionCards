# FSRS retention and historical replay

Status: accepted.

## Decision

Pin `ts-fsrs` to `5.4.2`, whose implementation uses FSRS 6. Disable interval fuzzing so identical
inputs produce identical scheduling state. Start with the pinned default weights and a target
retention of 90%; expose a private workspace preference from 70% to 97%.

Scheduling and content import operations receive an explicit timestamp from the platform boundary.
The scheduler never reads the clock. Replay without events requires an explicit initial timestamp;
otherwise it returns `missing-initial-timestamp` through its typed failure channel.

Causal event order takes precedence over timestamp order. For each transition, the derived
scheduling time is the later of the event time and the schedule's previous review time. This
prevents negative elapsed time after device clock rollback or server clock correction. The same
rule applies to live reviews, previews, and historical replay. Raw and server-effective timestamps
remain unchanged in the review log; consecutive reviews may have zero elapsed scheduling time.

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
Parameter fitting is an explicit local operation and is never triggered by an ordinary review.
The experimental fitter uses bounded coordinate search over the pinned FSRS weights, scoring
interday next-answer predictions with every fifth observation reserved for validation. It starts
from the selected weights (or pinned defaults), requires at least 100 interday observations, uses
complete histories for up to 200 deterministically selected cards (at most 5,000 reviews), and only proposes a candidate
when validation loss improves. This is not Anki's native optimizer and is not an independent
benchmark of learning effectiveness. Users select a proposal and save settings before it applies.

Fitted weights are quantized to three decimal places for both scheduling and replay. The
parameter identifier `t542p1-<base36 retention>-<21 three-character base36 weights>` contains the
entire parameter set within the legacy 80-character bound. Each encoded weight represents
thousandths, bounded to 0–46.655. Unknown versions and malformed identifiers fail explicitly.
Legacy default identifiers retain their original interpretation. Preferences and suspension stay
private in local workspace backups; review sync preserves them and transports the self-contained
parameter identifiers, but does not synchronize the preferences themselves between devices.

Study queues prioritize due learning/relearning steps, then established reviews, then new cards.
The default workspace-wide introduction budget is 20 cards per local calendar day; users can
choose 0–1000. First introductions are derived from deduplicated review history across subjects.
Users can pause introductions while previous days' reviews remain overdue (enabled by default).
Daily limits never hide established reviews. Review ordering can use due date or estimated recall
probability, with due date and stable identity as fallbacks for incomplete legacy schedules.

Sibling burying is derived from today's review history and known note identities or authored
cloze text. It leaves schedules unchanged and allows repetitions of the reviewed sibling.
Suspension excludes a card from scheduled and extra practice until resumed. Cards with eight
review lapses are flagged for repair by default; the threshold is configurable, and suspension
is always a user action. Extra practice uses transient session state, never review-log events,
and does not affect intervals, introduction counts, or fitted parameters.

## Presets, scheduling controls, and administration

Named presets inherit through an acyclic subject-parent map. A subject's nearest assigned
preset overrides workspace policy. Introduction allowances respect workspace and explicitly
assigned ancestor budgets, counting introductions across descendants. This grouping is for
settings, budgets, and statistics; it does not create an Anki-compatible nested deck browser.
Fitting a preset uses only review histories belonging to subjects inheriting that preset.

Optional learning/relearning delays are increasing integer minutes (at most five, each up to
one day). Empty arrays delegate those steps to FSRS. Maximum intervals are 1–36,500 days.
Reduced-load weekdays deterministically move future review-state intervals by at most two days,
respecting the interval cap and at least one day; learning steps remain untouched. Weekdays use
an explicitly saved IANA time zone, defaulting to UTC, while study budgets use the supplied local
calendar day. These controls change future transitions, not existing due dates.

Advanced transitions use `t542v2-` followed by compact JSON containing retention, optional weights,
steps, maximum interval, weekdays, time zone, and an optional reset timestamp. The review-sync
parameter identifier bound is now 2,048 characters in shared contracts and API validation.
Existing default and compact fitted identifiers retain their historical interpretation. Clients
must support this identifier version before receiving advanced transitions; unsupported versions
fail replay without replacing the local workspace.

Manual set-due/reset operations append private scheduling adjustments anchored to the latest
causal review event. Replay reapplies pending adjustments until a subsequent answer consumes them.
Recorded adjustment times strictly increase per card, including after clock rollback. Reset
retains old answer events and transports a reset timestamp in subsequent review identifiers so
other updated clients can rebuild the reset memory state from synced answers. Repositioning
updates private new-card order. Pending adjustments and preferences are preserved by review sync
and included in private backups, but do not automatically synchronize as settings between devices.
Filtered practice remains transient; explicitly filtering scheduled study narrows the ordinary
queue without bypassing suspension, burying, introduction budgets, or normal answer logging.

Statistics are derived from deduplicated answer events and current schedule caches. Daily retention
counts the first answer per card per local day, including learning answers. Measured duration uses
only events with elapsed time; current clients cap a single recorded answer at 60 seconds. Due
forecasts count current established-card dates and do not simulate future answers or new cards.
