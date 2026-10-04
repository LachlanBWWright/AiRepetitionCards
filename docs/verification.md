# Regression verification

Run `pnpm test` from the repository root. `pnpm check:pure` runs these checks and the static source/type/lint/format/application/Storybook gates. `pnpm check` also requires the separate local Supabase integration suite below. Browser/device end-to-end checks and release verification remain unfinished gates; neither command claims to exercise them.

The private `@recall/verification` package uses [Node's test runner](https://nodejs.org/download/release/v22.17.0/docs/api/test.html). Its [esbuild runner](https://esbuild.github.io/api/) bundles actual workspace TypeScript into a temporary directory, targets Node 22, executes under UTC and removes the bundles afterward. Tests are typechecked and included in strict zero-warning lint, formatting and source policy. Production clients never depend on this package.

The runner selects the `react-server` package-export condition so real server adapters can be imported in their intended server context. Adapter fixtures replace HTTP transport and use synthetic environment values; no app server or live service is started.

Run one file with `pnpm --filter @recall/verification test import-security.test.ts`. Unknown filenames fail instead of silently running a different suite.

## Local Supabase integration

`pnpm test:integration` runs real Supabase Auth, PostgREST and Storage calls against an explicitly configured disposable local stack. It never starts, resets or migrates that stack. Supply these variables from the local Supabase CLI's status output:

```dotenv
RECALL_INTEGRATION_SUPABASE_URL=http://127.0.0.1:54321
RECALL_INTEGRATION_SUPABASE_PUBLISHABLE_KEY=<local publishable or anon key>
RECALL_INTEGRATION_SUPABASE_SERVICE_ROLE_KEY=<local secret or service-role key>
```

Use the existing local schema and a disposable test stack. The runner accepts only loopback origins, rejects URL credentials/paths/query/fragments and validates key roles without printing their values. It does not read application credentials or default to hosted endpoints. Missing configuration fails before bundling or contacting services; it never skips integration checks and reports success.

`pnpm --filter @recall/verification test:integration --check-config` validates configuration without contacting services. This only checks configuration shape; Supabase verifies the credentials during the actual suite. Integration files are excluded from `pnpm test`, but included in strict TypeScript, lint, formatting and policy checks.

CI has a separate integration job that creates a fresh local Supabase stack, obtains its credentials without printing the status payload, runs the suite and stops the stack even after failure. This workflow source is not evidence that the integration suite has passed. No database commands were run in the implementation session.

The suite provisions isolated owner/stranger Auth accounts and proves each fixture has owner-visible data before checking anonymous/foreign denial across 16 private tables. It exercises authenticated content provisioning, foreign sync rejection, append-only table permissions, private/public/unlisted publication visibility, hidden capability digests, media ownership and path namespaces, referenced-media access, token rotation/revocation and denied deletion. Service credentials are used for fixture creation/cleanup, never as the ordinary owner or stranger. Cleanup targets only the generated fixture users, publication IDs and exact media paths.

There is no collaborator model in the current single-owner/private-fork scope. This suite does not exercise Next.js Route Handlers, the repository adapter functions, full sync orchestration or browser/device flows. Compilation and configuration-only checks are not a passing live isolation result.

## Current scope

- Frozen scheduler fixtures and seeded properties cover first review, ratings, repeated failure, same-day reviews, long gaps, retention changes, typed replay failures, deterministic finite state and historical replay.
- Clock/sync checks cover real calendar parsing, future clamping, raw evidence preservation, causal ordering, branch behavior, independent schedule hashes, canonical acknowledgment reconciliation, retries and immutable identity collisions.
- Content/domain checks cover version migration, unknown-version rejection, Basic/Cloze validation, seeded round trips and private-state exclusion from portable exports.
- Authoring/approval checks cover stable identities, schedules/provenance/history preservation, stale draft rejection, concurrent reviews, deleted review retention, private preferences and idempotent approved cards.
- Tutor/provider and budget checks use deterministic fake transports and ports to verify output/capability validation, expected provider failures and reservation/settlement behavior.
- Hostile import fixtures exercise ZIP paths, duplicate entries, archive limits, malformed ZIP/Zstandard data, media integrity, HTML sanitization, delimited exports and private-backup tampering using in-memory archives and validated mock readers.
- Workspace sync fixtures run the application orchestration against in-memory ports: owner checks, media checkpoints, uncertain acknowledgments, canonical receipts past the pull cursor, deleted/live card provisioning, interrupted tombstones and retry preservation.
- Release preflight fixtures invoke configuration checks with fake credentials, reject unsafe endpoints and verify that secrets are not printed. They never request a cloud build.
- Contract fixtures check invalid versions, identities, bounds, timestamps, provenance and client acknowledgment matching without starting route servers.
- Publication recovery fixtures recompute real content hashes and reject tampered documents or changed publish acknowledgments. Tutor limiter fixtures check retry bounds, status/code association, unknown error names and daily-budget distinctions, including malformed limiter responses during session restoration.
- Tag properties exercise 300 seeded arbitrary UTF-16 arrays, quoted delimiters, whitespace, empty/duplicate tags and unchanged imported values beyond authoring limits. Shared card/area commands preserve schedules, provenance and append-only reviews.
- Media fixtures exercise paired commit ordering, new-only rollback, conservative uncoordinated retention, rollback failures and genuinely concurrent commits against in-memory stores. They do not simulate browser Web Locks or native power loss.
- HTTP adapter fixtures check real Redis REST serialization, hashed keys, response limits, transport/configuration failures and trusted IPv4/IPv6 normalization with keyed identities. They do not execute the Redis script or prove a deployed proxy strips forged headers.

These are executable examples and properties, not proof of every report invariant. Fake infrastructure does not verify Redis atomic scripts, Postgres/RLS, Storage policies, keyrings, real provider streams, real exported Anki archives, device power loss or signed artifacts. Contract coverage is still incomplete for all Route Handlers. The [completion audit](implementation-audit.md) remains the release ledger.

To reproduce a property failure, preserve the printed seed/path and rerun the corresponding test. Add focused fixtures for a repaired regression; do not weaken the property or suppress lint to obtain a green run.
