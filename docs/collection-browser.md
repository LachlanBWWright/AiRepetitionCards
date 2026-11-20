# Collections and browser

Subjects support up to 50,000 cards and 50,000 shared notes. Imports remain subject to archive,
expanded-data, media and document byte budgets. A large card count does not override those budgets.

The browser shows 50 rows per page in Cards or Notes mode. Notes mode groups generated siblings
under one source note; independent cards remain separate rows. Search normalization, source-note
lookups and review-event grouping are indexed once per immutable workspace revision. Changing page
does not rebuild or sort the collection. Plain text searches of three or more normalized characters use sorted trigram posting lists to
select candidate rows before verifying substring matches. The browser retains an instance-scoped
revision indexer: schedule-only changes reuse normalized text and posting lists, while card/source
field changes invalidate the affected text and rebuild postings. Boolean AND/OR combines candidate sets;
negation, short text and structured-only queries fall back to scanning. Exact verification preserves
substring and Unicode normalization semantics. This is an in-memory index, not a server-side
search engine or an unlimited collection store.

Alongside existing Boolean, scheduling, deck and tag searches, use:

- `note:"Basic reverse"` for a note type name, or its identifier.
- `card:Reverse` for a generated template name, or its identifier.
- `field:Extra:mitochondria` for text within a named source field. Quote field names containing spaces.
- `re:"^Mitochondria [0-9]+$"` for a bounded regular expression against individual fields.

Regex patterns are limited to 120 characters. Groups, alternation, brace quantifiers and
backreferences are rejected. Only one variable repetition is supported, and it requires a leading
`^` anchor. Unsupported patterns fail explicitly. These restrictions prevent authored content
from triggering expensive backtracking searches.

Find and replace can target a source note field as well as independent Basic fields and cloze
sources. Source edits deduplicate sibling matches, resolve routed cards to their canonical note,
and regenerate all linked cards atomically. Schedules retain their identities. A replacement that
needs fresh card identities, such as a new cloze deletion, is rejected; use the source editor for
that structural change. Each bulk proposal remains bounded to 500 matching rows in one subject.

## Durable storage and sync

Native and Electron SQLite snapshots use Unicode-safe chunks of at most 65,536 UTF-16 characters
per row, avoiding large SQLite cursor rows. The manifest and changed chunks commit atomically. SQLite upserts compare payloads and update
only changed rows; shrinking snapshots remove stale tail chunks. Equal-length localized edits
therefore avoid rewriting every chunk. Insertions that shift subsequent chunk boundaries may still
update the remaining chunks.
Existing single-row snapshots are read until the next write. Missing or out-of-order chunks fail
the read; they never become an empty workspace. Snapshot writes have an explicit 100 MB UTF-8
budget. Recovery archives use the same chunk codec.

Private study metadata uses indexed, append-only database rows. `/api/v1/workspace/study/pages`
reads keyset pages and writes only new entries, with at most 5,000 entries and 5 MB per request.
Every page belongs to the same revision; concurrent changes abort the read rather than mixing
snapshots. Writes compare revisions and reject conflicting existing entries. Retrying after a
partial upload preserves accepted entries and uploads the remainder. A dedicated authenticated
rate-limit scope allows 120 page requests per minute.

The application validates up to 200,000 entries in each adjustment/correction/undo collection and
50,000 imported schedule baselines. Bounds cause an explicit failure, never silent truncation.
Apply `20261023000000_paged_study_metadata.sql` after the preceding study migrations before using
the new protocol. Legacy RPC reads and complete-document writes remain compatible and preserve
normalized entries. Account exports include the normalized metadata on both server platforms.

Connected note families and card moves remain atomic during sync, using current and prior links.
Independent families are split into bounded requests. A family must fit the 100-subject,
50,000-card and 50 MB request budgets; an oversized family is rejected before uploads. Local editing still rebuilds
an immutable workspace snapshot; SQLite chunks address durable row size, not incremental domain
updates. Very large workspaces therefore still require memory proportional to their full content.

Apply `20261024000000_atomic_linked_notes.sql` after the paged-metadata migration to enforce
whole-family writes, preserved card movement and protected source deletion.

## Reproducible collection benchmark

Run `pnpm benchmark:collection` through the root tooling slot.
The synthetic 50,000-card fixture measures serialization, initial SQLite write, opening reads,
search-index construction, selective search, a real scheduled answer, review serialization/write,
a localized edit and backup reading/encoding.
It reports changed chunk counts in addition to timings. It uses in-memory SQLite to isolate
application work; disk durability, network sync, app launch, review workflow latency and physical
device performance require separate acceptance measurements. Timings are diagnostic, not CI gates.
Regression checks assert selective candidate counts, scan-equivalent results at 50,000 cards,
changed-row counts, Unicode round trips, tail deletion and rollback after write failure.

The workspace is still serialized and read as a complete document. Revision reconciliation still
visits each card, even when text/postings are reused; edits and reviews do not yet apply entity-level database
deltas. This improvement reduces database page writes and repeated query scans without claiming
constant-memory collection opening or background persistence.
