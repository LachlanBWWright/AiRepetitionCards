# Regression verification

Run `pnpm test` from the repository root for unit regression and seeded property checks.
`pnpm test:local-integration` runs the local application and storage integration suite.
`pnpm check:pure` includes both and the static source/type/lint/format/application/Storybook
gates. `pnpm check` also requires the separate local Supabase suite below. Browser E2E tests
run through `pnpm test:e2e`; native device and signed release verification remain separate.

The private `@recall/verification` package uses [Node's test runner](https://nodejs.org/download/release/v22.17.0/docs/api/test.html). Its [esbuild runner](https://esbuild.github.io/api/) bundles actual workspace TypeScript into a temporary directory, targets Node 22, executes under UTC and removes the bundles afterward. Tests are typechecked and included in strict zero-warning lint, formatting and source policy. Production clients never depend on this package.

The runner selects the `react-server` package-export condition so real server adapters can be imported in their intended server context. Adapter fixtures replace HTTP transport and use synthetic environment values; no app server or live service is started.

Run one file with `pnpm --filter @recall/verification test import-security.test.ts`. Unknown filenames fail instead of silently running a different suite.

## Local application integration

Run `pnpm test:local-integration`, or select a file with
`pnpm --filter @recall/verification test:local-integration private-library.test.ts`.
These tests use the same strict TypeScript runner, without service configuration.

The suite combines authoring, review scheduling, durable save/reload, version restoration,
duplicate checks, tutor approvals, notebook source validation, search and private backup ZIPs.
It verifies historical attachments, atomic replacement, failed media commits and stale restore
baselines. Browser notebook tests execute the real adapter with fake local storage and locks,
including namespace isolation, corruption, concurrent edits, pending reviews and cleanup fences.
Mocks replace external I/O; no browser, SQLite process or database service is started.

CI runs both local suites on pull requests and main commits.

## Browser end-to-end workflows

```bash
pnpm --filter web exec playwright install chromium
pnpm test:e2e
```

The runner builds the real offline web application and Storybook, serves them on an ephemeral
loopback port and runs Chromium cases with fresh browser contexts. Tests exercise UI actions
and inspect committed IndexedDB records, covering duplicate decisions, card history and recovery,
append-only reviews, search filters and navigation, offline reload and workspace isolation.
Mock Storybook cases cover AI refinement controls and shared native UI interactions without
provider calls. These native cases render through React Native Web; they do not prove device
notifications, native SQLite, OCR engines or Electron operating-system integration.

External network requests are blocked, and unexpected requests or unhandled page errors fail
the tests. No Supabase or OpenAI credentials are needed. The runner writes JUnit results to
`artifacts/e2e/results.xml`; failures also save screenshots, traces and diagnostics. The separate
E2E CI workflow installs Chromium and uploads these artifacts on pull requests and main commits.

`pnpm --filter web test:e2e --check` checks JavaScript syntax only and starts no builds, server
or browser. `RECALL_E2E_SKIP_BUILD=1 pnpm test:e2e` reuses existing application and Storybook
builds. Syntax checks are not evidence of passing browser workflows; browser execution was
deferred locally in accordance with the workspace's no-browser preference.

Select individual browser files with `pnpm test:e2e card-workflows.test.mjs`, or use
`pnpm test:e2e --check card-workflows.test.mjs` for syntax only. Unknown flags, unknown paths
and repeated selections fail before builds, servers or browsers can start.

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
- Version history checks cover no-op edits, immutable snapshot chains, restore/recover behavior,
  scheduling preservation, ownership changes during previews, objective dependencies, capacity,
  malformed snapshots and identity collisions. Duplicate/search properties cover cloze retrieval
  targets, conflicting answers, conservative similarity, canonical deduplication, namespaces,
  deterministic ordering, limits and Unicode-normalized snippets.
- Tutor/provider and budget checks use deterministic fake transports and ports to verify output/capability validation, expected provider failures and reservation/settlement behavior.
- Hostile import fixtures exercise ZIP paths, duplicate entries, archive limits, malformed ZIP/Zstandard data, media integrity, HTML sanitization, delimited exports and private-backup tampering using in-memory archives and validated mock readers.
- Workspace sync fixtures run the application orchestration against in-memory ports: owner checks, media checkpoints, uncertain acknowledgments, canonical receipts past the pull cursor, deleted/live card provisioning, interrupted tombstones and retry preservation.
- Release preflight fixtures invoke configuration checks with fake credentials, reject unsafe endpoints and verify that secrets are not printed. They never request a cloud build.
- Contract fixtures check invalid versions, identities, bounds, timestamps, provenance and client acknowledgment matching without starting route servers.
- Publication recovery fixtures recompute real content hashes and reject tampered documents or changed publish acknowledgments. Tutor limiter fixtures check retry bounds, status/code association, unknown error names and daily-budget distinctions, including malformed limiter responses during session restoration.
- Tag properties exercise 300 seeded arbitrary UTF-16 arrays, quoted delimiters, whitespace, empty/duplicate tags and unchanged imported values beyond authoring limits. Shared card/area commands preserve schedules, provenance and append-only reviews.
- Media fixtures exercise paired commit ordering, new-only rollback, conservative uncoordinated retention, rollback failures and genuinely concurrent commits against in-memory stores. They do not simulate browser Web Locks or native power loss.
- Reminder checks validate every local clock minute and exercise real browser adapter/runtime
  code with controlled Notification, storage, service-worker, event and clock ports. They cover
  permission decisions, daily delivery, cleanup and failure paths without real notifications.
  E2E runner checks prove help, syntax-only selection and invalid arguments avoid runtime work.
- HTTP adapter fixtures check real Redis REST serialization, hashed keys, response limits, transport/configuration failures and trusted IPv4/IPv6 normalization with keyed identities. They do not execute the Redis script or prove a deployed proxy strips forged headers.

These are executable examples and properties, not proof of every report invariant. Fake infrastructure does not verify Redis atomic scripts, Postgres/RLS, Storage policies, keyrings, real provider streams, real exported Anki archives, device power loss or signed artifacts. Contract coverage is still incomplete for all Route Handlers. Browser workflows must pass separately before claiming runtime UI coverage. The [completion audit](implementation-audit.md) remains the release ledger.

To reproduce a property failure, preserve the printed seed/path and rerun the corresponding test. Add focused fixtures for a repaired regression; do not weaken the property or suppress lint to obtain a green run.
