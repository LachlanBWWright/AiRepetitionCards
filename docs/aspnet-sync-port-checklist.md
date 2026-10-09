# ASP.NET Core sync port checklist

This checklist captures the behavior an ASP.NET Core implementation must preserve for `/api/v1/sync` and its coordination with workspace content and tombstone endpoints. Treat the existing [sync protocol](sync-protocol.md), contracts, route, adapters, migrations, and verification tests as the compatibility source. Keep the public JSON contract at schema version 1 during the port.

## Boundaries and ownership

- [ ] Authenticate every push and pull using the canonical Supabase user ID. Apply the same authenticated `review-sync` rate limit to both methods.
- [ ] On every request after owner discovery, validate `x-recall-workspace-owner` against the authenticated account before constructing mutation context. A mismatch must fail before writes and retain the existing account-change response behavior.
- [ ] Keep data access owner-scoped. Review reads and writes use `user_id`; change-stream reads filter `user_id`; card-to-area lookup must only enrich accepted/visible event identities. Preserve the existing RLS assumptions if using Supabase's authenticated client. A privileged Postgres connection needs equivalent explicit authorization checks.
- [ ] Keep sync transport response bodies bounded and private/no-store, and preserve request deadlines, cancellation, request observation, and the endpoint's existing rate limit behavior.
- [ ] Parse request JSON as untrusted input. Validate schema version, UUID-backed identifiers, timestamps, enum values, integer bounds, nullable metadata, and exact batch limits before persistence.

## Push: `POST /api/v1/sync`

### Request and validation

- [ ] Accept `{ schemaVersion: 1, deviceId, operations }` with at most 100 causal-order operations. The route currently caps JSON at 512,000 bytes; oversized bodies return `413 { error: "request-too-large" }` and invalid JSON returns `400 { error: "invalid-request" }`.
- [ ] Each operation carries stable `id`, `cardId`, positive `deviceSequence`, nullable `baseReviewEventId`, device and effective timestamps, rating (`again|hard|good|easy`), nullable nonnegative safe integer `elapsedMs`, scheduler family `fsrs`, bounded scheduler version and parameter-set ID, and nullable 64-hex `previousStateHash`.
- [ ] Keep missing elapsed-time metadata as null. Do not infer a duration, timezone, clock offset, or scheduler parameter set.
- [ ] Reject invalid actual calendar dates, times, offsets, and years before any write. Normalize timestamps to UTC millisecond precision for storage/comparison. Derive a new event's effective time from `reviewedAtDevice` and the server reception instant: retain older offline instants and clamp future instants to reception. Ignore the submitted effective timestamp when choosing a newly admitted event's effective time; retain it in the v1 request for compatibility.

### Persistence and idempotency

- [ ] Persist review events append-only. A retry with the same event ID and immutable metadata is accepted as a duplicate; preserve the first admitted effective timestamp and do not rewrite the original event based on the retry's reception time.
- [ ] Compare duplicate timestamps as instants, not string representations. Duplicate equivalence includes event/card/device IDs, device sequence, base event ID, device timestamp, rating, elapsed duration, scheduler family/version/parameter set, and previous-state hash. A changed immutable value is an `id-collision`.
- [ ] Respect uniqueness of `(user_id, device_id, device_sequence)`. Classify a sequence uniqueness collision as `device-sequence-conflict`; do not convert it into a generic success or overwrite another event.
- [ ] Preserve partial acceptance semantics: determine accepted IDs from the rows actually stored and exact metadata comparison. A conflict on one event must not cause unrelated accepted history to disappear.
- [ ] Rely on the database insert trigger to append a `review_event/upsert` row to `sync_changes` atomically with each new review insert. Duplicate retries must not create another change row. Keep `sync_changes` as the ordered source for pull.
- [ ] After persistence, return canonical `acceptedReviewEvents` for exactly the accepted IDs, including duplicate retries. Each receipt includes canonical area/card/device IDs and all immutable review metadata, plus canonical `ratedAt` and `effectiveReviewedAt`. It corrects only local derived timestamps; it must not replace local immutable review history.
- [ ] Keep receipt cardinality bounded by the 100-operation batch limit. Preserve response shape `{ schemaVersion: 1, acceptedIds, acceptedReviewEvents, conflicts, cursor }` and current error classification: validation `400`, identity/sequence conflict response `409` where applicable, vendor persistence/read failures `502` with the established error code.
- [ ] Cursor in a push receipt is the current owner-scoped highest change sequence after the write, represented as a decimal string. Read/validate it without lossy numeric conversion; invalid or failed cursor reads are server errors, not cursor zero.

## Pull: `GET /api/v1/sync?cursor=...`

- [ ] Require exactly zero or one `cursor` query value. Default an absent cursor to `0`; accept only 1–20 decimal digits. Duplicate or malformed parameters return `400 { error: "invalid-cursor" }`.
- [ ] Read changes for the authenticated owner with `sequence > cursor`, ascending sequence order, fetching at most 101 rows to detect another page. Return at most 100 changes and set `hasMore` when the 101st row exists.
- [ ] Validate all fetched rows at the persistence boundary before constructing output: entity/operation pairing, payload fields, timestamps, review metadata, identifiers, and positive decimal sequence. Sequence values may arrive as decimal strings or safe positive integers from the database adapter; do not lose precision.
- [ ] Verify every returned sequence is strictly greater than the requested cursor and strictly increasing. Validate ordering over the fetched result, including the lookahead row. The response cursor is the last emitted sequence, or the input cursor for an empty page.
- [ ] For review changes, require `payload.id == operation_id == entity_id`; resolve the card's area identity and fail closed if it is missing. Construct the domain review event with `ratedAt` equal to normalized effective review time, retaining original device time and device identity.
- [ ] For card and area tombstones, require payload `id == entity_id`; preserve tombstone `areaId` and canonical deletion time. Never synthesize or omit tombstones based on a latest snapshot.
- [ ] Return `{ schemaVersion: 1, changes, cursor, hasMore }`, with a maximum 100 changes. Invalid database rows or response-schema failures return `502 { error: "sync-response-invalid" }`; repository read failures return `502 { error: "sync-read-failed" }`.

## Client coordination and cross-endpoint ordering

- [ ] Preserve the shared coordinator's order: workspace snapshot and canonical owner check; durable owner checkpoint; latest local outbox preparation; media upload; optimistic content push; at most 100 causal review operations; eligible card/area tombstones; bounded pull and validation; reconciliation and durable checkpoint.
- [ ] Bind a fresh workspace durably before any cloud mutation. Failed binding persistence or a different canonical account must stop writes. All sync calls after discovery carry the owner header; media access is bound to the same owner.
- [ ] Do not upload content that references media until media upload succeeds. Content pushes include each area's base hash and must preserve conflict preview/explicit approval behavior.
- [ ] Before review pushes, resolve up to 100 owner-scoped card identities. Existing identities, including tombstoned cards/areas, can receive historical reviews. Missing identities require retained private content and prerequisite closure; missing recovery evidence and capacity overflow fail explicitly while preserving the outbox.
- [ ] Defer card tombstones while that card has pending reviews. Send area tombstones only after its pending review history is acknowledged, with the fresh expected content hash. Preserve retries after a lost response and do not duplicate review history.
- [ ] Pull at most 100 pages per invocation, each page max 100. Validate cursor progress and every change before applying. On a larger backlog, checkpoint append-only history and the validated cursor, set `syncHasMore`, defer uploads, and continue from that cursor next invocation. Do not hydrate an incomplete backlog from a latest snapshot that could remove content before historical reviews replay.
- [ ] Reconcile against the latest local workspace after network work. Preserve edits/deletions and private retained review evidence created in flight; update acknowledged hashes, cursor, accepted IDs and derived schedules. A failed validation/replay must leave the previous durable checkpoint intact.
- [ ] Keep schedules rebuildable from append-only review history using each event's recorded scheduler parameter set. Unknown parameter sets are typed replay failures and must not silently select current defaults.

## Verification scenarios

Run existing compatibility tests as a baseline and add/use equivalent tests against the .NET API and real persistence adapter. `packages/verification/tests/workspace-sync.test.ts` currently covers:

- [ ] Durable fresh-owner checkpoint before content/media/review writes; checkpoint failure and account mismatch block writes.
- [ ] Lost review response followed by idempotent retry; canonical receipt repairs effective/rated time even when the pull cursor has passed the event.
- [ ] Mixed deleted/live review batch provisions all needed identities before review upload and releases only deleted evidence after tombstone completion.
- [ ] Failure after review ACK but before tombstone retains local history/evidence; retry completes deletion without duplicate reviews.
- [ ] Corrupt canonical receipt (immutable elapsed metadata mismatch) preserves the pending local review.
- [ ] Account change at mutation boundary rejects upload without discarding offline data.
- [ ] Missing retained deleted-card content fails explicitly before content/review mutation and preserves the outbox.

Also verify the following route and storage behaviors, which are not adequately established by source compilation alone:

- [ ] Same event ID + same metadata is accepted on retry; same ID + altered timestamp/metadata is `id-collision`; same device sequence + different ID is `device-sequence-conflict`.
- [ ] Future device timestamp clamps to injected server time; old offline timestamp remains; retries preserve first accepted effective time; equivalent timestamp offsets compare equal.
- [ ] Invalid impossible dates, missing explicit offset, malformed IDs, negative/fractional/unsafe elapsed duration, oversized body, 101+ push operations, and duplicate cursor query values fail before writes with expected status/error.
- [ ] Pull pages at 0, 1, 100, 101, 200, and 201 changes have exact cursor/`hasMore` behavior; empty pull retains cursor; a 20-digit cursor stays precise.
- [ ] Pull rejects duplicate/decreasing sequences, sequence not after cursor, malformed rows, mismatched review IDs, missing card-area mapping, and malformed tombstone identity.
- [ ] Two owners cannot read each other's review events/change rows or use another owner's card identity. Verify through RLS and the actual API auth path, not only mocked repositories.
- [ ] Concurrent device review inserts preserve both append-only events and a total ordered change stream. A crash/connection loss between request and response is recoverable through retry and pull.
- [ ] Tombstone/review interleavings cover pending review on a deleted card, area deletion across multiple batches, concurrent content edit, and tombstone idempotency.
- [ ] Schema fixtures are shared across TypeScript and C# for both accepted and rejected inputs, especially null/optional metadata and canonical timestamps.

## Release gates

- [x] Development-only Swagger UI and generated OpenAPI document are available for the ASP.NET route map.
- [x] Document OpenAPI operation statuses, request-body content types, common error envelopes, auth alternatives, and known query/header parameters; `backend/scripts/verify-openapi.py` checks the live document.
- [ ] Replace intentionally open JSON schemas with generated/shared contract schemas for every polymorphic request and response, then verify them with cross-language fixtures before production cutover.
- [ ] API builds with nullable reference types and analyzers enabled; expected errors are typed results, with provider/HTTP exceptions classified in infrastructure adapters.
- [ ] Integration environment uses the real Supabase Auth/RLS policies, SQL trigger, constraints, and tombstone functions. Confirm migrations are not duplicated or silently replaced by EF migrations.
- [ ] Exercise interrupted sync, concurrent device acceptance, RLS isolation, and ordered pagination against a disposable database before release; protocol documentation explicitly calls these runtime checks necessary.
- [ ] Cut over the `/api/v1/sync` route only after client compatibility and runtime gates pass. Keep one write owner for this endpoint, retain routing rollback, and do not dual-write/replay production mutations to both implementations.
- [ ] After cutover, monitor classified 4xx/5xx rates, sync retries, backlog (`hasMore`/`syncHasMore`), and conflict counts. Remove the Next.js route only after the rollback window and endpoint parity are confirmed.
