# Recall

Recall is an offline-capable spaced-repetition learning app with web, Expo mobile and Electron desktop clients. All three share learning areas, card authoring, FSRS reviews, sync, AI tutoring with approved proposals, interchange and publishing.

## Run locally

Requirements: Node.js 22 and pnpm 10. No account, environment file, Supabase service or OpenAI credential is required for local study.

```bash
pnpm install
pnpm dev
pnpm dev:mobile
pnpm dev:desktop
```

Run each client command in its own terminal. Local card authoring, FSRS reviews, attachments, imports and private backups use IndexedDB on web and SQLite on desktop/mobile. Cloud sign-in, sync, publishing and hosted AI tutoring require optional service configuration; they do not block the local workspace. Without configuration, sign-in offers a direct local-study action and the native Account, Tutor and Sharing screens explain local options instead of offering unavailable network actions.

| Local application | Command            | Storage                |
| ----------------- | ------------------ | ---------------------- |
| Web               | `pnpm dev`         | IndexedDB              |
| Desktop           | `pnpm dev:desktop` | SQLite                 |
| Mobile            | `pnpm dev:mobile`  | SQLite                 |
| Mock screens      | `pnpm storybook`   | Deterministic fixtures |

Storybook includes full-screen mock screens for all three clients. Screenshot targets are registered; running the screenshot command launches a browser, so it is separate from local development.

Turborepo coordinates workspace checks and builds. `pnpm typecheck` checks every shared package and app independently; `pnpm lint` checks all authored source. `pnpm build`, `pnpm build:desktop`, and `pnpm build:mobile` compile one client, while `pnpm build:all` compiles all three. See the [task graph decision](docs/adr/0004-workspace-task-graph.md) for cache boundaries and source dependencies.

Open <http://localhost:3000> for web, or use the Expo QR code from `pnpm dev:mobile` on a device. `pnpm dev:desktop` starts the Electron client with the shared study UI and main-process SQLite workspace storage. Desktop email-link sessions are encrypted with Electron `safeStorage`; bearer tokens stay in the main process, which proxies authenticated sync and tutor/account requests through a fixed endpoint allow-list. Desktop cloud features are disabled when Supabase is unconfigured or the OS does not provide encrypted storage. Web, Electron, and mobile sync hash-verified private media referenced by shared Knowledge Areas alongside content; browser media uses IndexedDB and native clients use SQLite. Mobile saves its workspace, review history, and media in SQLite, supports email-link sign-in and bearer-token sync, and requires approval before loading a conflicting server version. Native JSON/ZIP import remaps portable Knowledge Areas; ZIP packages preserve verified media while excluding private schedules and review history. The native account panel supports cloud account export, confirmed account deletion, sign-out that preserves offline data, and private backup export and restore. Deletion clears the device workspace, attachment store, and associated tutor-session links after the cloud deletion succeeds. See [`apps/mobile/README.md`](apps/mobile/README.md) for setup. Device-level validation remains in progress.

For mobile sign-in and sync, copy [`apps/mobile/.env.example`](apps/mobile/.env.example) to `apps/mobile/.env`. On a physical device, set both service URLs to hosts reachable over the local network; `localhost` points to the device itself. See [`apps/mobile/README.md`](apps/mobile/README.md) for redirect and email-template setup.

Build a local unpacked desktop bundle with `pnpm package:desktop`. Native release artifacts can be built on their target operating systems with `pnpm --filter desktop dist:linux`, `dist:mac`, or `dist:windows`. These commands do not sign or notarize installers; production distribution still needs platform signing credentials and release configuration.

## Optional Supabase and account sign-in

Skip this section for local-only development. When account-backed features are needed later, install Docker Desktop or another Docker-compatible runtime, then start the local Supabase services:

```bash
pnpm supabase:start
```

Copy the local API URL and publishable key printed by the CLI into `apps/web/.env.local`, using `apps/web/.env.example` as the template. Restart the web or desktop app after changing environment variables. Local Supabase includes the email template and callback configuration for passwordless sign-in. Emails are captured by the local mail inbox rather than delivered externally. Desktop uses `RECALL_API_URL` to reach the authenticated web API; its development default is `http://localhost:3000`.

For account deletion, also set `SUPABASE_SERVICE_ROLE_KEY` to the project's server-only service-role key. Never use this key in a `NEXT_PUBLIC_` variable or expose it to browser code. Deletion is disabled when this key is missing; the owner-scoped erasure function removes account records before the Supabase Auth Admin API removes the identity. Users must type `DELETE` to confirm. Web and Electron account controls support export and deletion. Device cleanup drains active storage writes, blocks further writes and stale workspace updates, and clears the local workspace, attachments, and tutor-session links. If cloud deletion succeeds but device cleanup fails, the device stays read-only and offers a cleanup retry. Clearing saved data reloads a fresh workspace only after all local cleanup succeeds.

Web storage uses one exclusive Web Lock and a persistent erasure epoch across tabs. Clearing data fences existing tabs before cleanup; they cannot save old content afterward. Failed cleanup keeps the fence active until a retry succeeds. Reloading after successful cleanup starts a fresh storage session. Browsers without Web Locks, or with unavailable epoch storage, keep local persistence read-only rather than allow an unsafe erase/write race. Electron uses its single-instance storage write lane.

Each browser tab also compares its last successfully loaded or saved workspace with the persisted snapshot inside the IndexedDB transaction before saving. If another tab committed changes, the stale tab becomes read-only and keeps its unsaved workspace in memory; it cannot overwrite newer cards or reviews. The recovery banner offers a private ZIP backup, a JSON snapshot that preserves reviews and schedules without attachment bytes, and reloading the latest saved workspace. Reloading discards that tab's unsaved changes, so export them first.

Web and Electron keep a rated answer visible until its review event and resulting schedule have been saved on the device. Rating controls lock immediately to prevent duplicate taps or keyboard input. A failed save offers an explicit retry of the same immutable review attempt; other workspace writes pause until it commits. The retry remains available when changing views. A private recovery JSON snapshot also includes any unconfirmed review attempt, while the visible review count advances only after a successful save.

Deleting a card or area offline keeps the minimum private content needed for its pending reviews. Deleted items remain absent from the library and study queue. Sync sends the required content, preserves the reviews, confirms deletion, and then releases the retained snapshot. Insights and native sync notices explain this pending state. If older saved data lost a deleted card's content, export the current private backup or review snapshot before replacing it with an older backup containing that card; backups are not automatically merged. If combined cloud and retained content exceed the area's card or objective limits, sync preserves local content and review evidence and asks you to export a backup before changing cloud content to free capacity. Conflict acceptance alone does not increase those limits. Reviews and other content are never discarded automatically.

AI tutoring is optional. To enable it, set a server-side `OPENAI_API_KEY` and `OPENAI_MODEL` in `apps/web/.env.local`; neither value is exposed to the browser. Tutor requests require a signed-in account. Area instructions and imported learning content are sent as untrusted prompt data. AI proposals enter the study deck only after the learner approves them.

Web and desktop review shortcuts leave focused media controls, form fields and text composition alone, so listening to an attachment cannot accidentally reveal or rate a card.

Tutor proposal review lets you correct the question, answer, learning objective and rationale before approval. After the card is saved locally, retrying a failed acknowledgment uses that saved content and locks further edits or rejection.

Targeted quizzes keep other answer drafts while one answer is evaluated. Review settings accept fractional targets, such as 90.5%, and preserve an unchanged saved target without rounding.

CSV/TSV exports retain a readable tags column and add `tags_json` to preserve punctuation inside individual tags when reimporting. Legacy delimited tag lists remain supported.

Web and desktop card review and library views preserve line breaks in questions and answers, including lists and worked examples.

CSV/TSV imports reject incomplete non-empty rows without importing a partial deck. Receiving a shared deck saves its verified attachments with the local copy; failed saves retain the cloud-copy retry and roll back newly written attachments when storage permits. Retrying an existing copy preserves local edits.

Browser, desktop and native clients coordinate attachment writes and the workspace save together. Standalone media writes retain successful attachments after a later failure so a retry cannot delete another operation's data. Publication reads, forks and acknowledgements validate the content hash; publish acknowledgements must also match the submitted content.

Tag editors preserve imported tag text, including commas and quotes. Separate tags with commas, quote a tag containing commas, and double embedded quotes inside a quoted tag. Unchanged imported tags retain their original values even when they exceed the limits for newly authored tags.

Card editing preserves your draft when a newer content revision arrives or a local save fails. The editor offers a deliberate reopening of the latest saved card; review schedule changes alone do not invalidate the draft.

Knowledge area and review retention settings confirm success after the local save completes. Concurrent content/settings changes keep your draft available with a conflict message; loading the latest settings requires confirming that the draft can be discarded. Review history and current card schedules survive settings saves.

Production API request limits use shared Redis counters; local development uses memory. Optional IP limits require a deployment-trusted single-address header and an HMAC secret. Configuration and proxy requirements are in [HTTP operations](docs/http-operations.md); limits fail closed on invalid configuration or storage failures.

Tutor request throttling shows a retry delay separately from daily AI budgets. Web, desktop and native tutor failures keep learner drafts, history and proposals; successful responses also preserve any newer text entered while the request was pending.

Creating, renaming and deleting library content also waits for a durable local save. Failed area saves retain their draft, and failed deletions retain a retry/cancel request without removing visible content. If content changes before deletion, retry requires reviewing and confirming the current version.

Web and desktop JSON/CSV/TSV imports retain the parsed content for retry when saving fails and report success after persistence. Mobile also imports/exports CSV and TSV through its file picker and share sheet. Mobile navigation separates Today, Library, Tutor, Sharing and Account while preserving open drafts. Desktop published links open in the default browser, and its trusted dashboard can copy share links.

Hosted AI can enforce optional daily admission budgets through durable Redis, with atomic in-flight reservations and verified usage settlement. See [daily budget configuration](docs/task-model-routing.md#daily-hosted-budgets). These conservative admission units do not promise an exact provider billing cap.

Website sign-in keeps first-party session credentials in HttpOnly, SameSite=Lax cookies, with Secure cookies in production. Account controls read verified status from the server; sign-out clears the current application session while preserving offline study data. [Sign in with ChatGPT setup](docs/sign-in-with-chatgpt.md) includes the OpenAI client request and activation steps; eligible desktop distributions also support local ChatGPT plan tutoring.

Set the issued token-endpoint authentication method explicitly; temporary sign-in outages offer retry or email recovery. Desktop ChatGPT credentials remain in the main process, and plan tutoring requires explicit consent.

Large decks use [deterministic tutor context selection](docs/tutor-context-selection.md), with the selected card count displayed in the tutor panel. Hosted mode requires large areas and their latest changes to be synchronized before starting a session; local ChatGPT mode preserves its full local snapshot. Context-size failures and API funding failures have separate recovery messages.

Native tutor proposal review supports editing the Basic question, answer, learning objective and rationale before approval. Invalid drafts and local save failures retain edits; acknowledgment retries use the exact durable card without overwriting it.

Tutor approval saves the local card before acknowledging the server proposal. If its immutable revision already synchronized, the server verifies ownership, approved content and session/proposal provenance before linking that revision; this repair requires the server-only `SUPABASE_SERVICE_ROLE_KEY`. Later revisions use the existing insert trigger. A failed repair leaves the proposal available to retry and preserves the durable local card. Session restore also retries unlinked approved proposals, up to 100 per request; failures or excess backlog return unavailable instead of hiding incomplete recovery.

For a hosted Supabase project, configure the site URL and redirect allow-list with both the web `/auth/confirm` URL and `recall://auth/confirm`, then set the Magic Link email template to link to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`. Set `RECALL_API_URL` to the hosted web API origin for desktop, and configure SMTP before sending production email.

See the [deployment runbook](docs/deployment-runbook.md) for staging and production setup, release gates, deletion operations, and incident steps. The [threat model](docs/threat-model.md) summarizes sensitive data, trust boundaries, current controls, and security gaps.

The database migrations create owner-scoped learning content and private, append-only review history. Published Knowledge Area snapshots have a separate immutable table with public reads and token-gated unlisted reads; snapshots carry attribution, license, and fork-lineage metadata without learner state. Web supports publishing verified image/audio media through a private Supabase Storage bucket, public/unlisted media reads, and reviewing attribution/license before forking a remapped local copy with fresh scheduling state. Owners can rotate or revoke unlisted links; only token hashes are stored. Shared Effect publishing and media gateways have web, Electron IPC, and mobile bearer-token transports. Native publishing/fork screens are implemented; device-level validation remains open. Row-level security is enabled for every application table. `pnpm policy` checks the source restrictions and migration RLS/privilege declarations; it does not replace running database policy tests. `pnpm supabase:types` regenerates the browser/server database types from the running local schema. `pnpm supabase:reset` rebuilds the local database from migrations and is destructive to that local database.

Publishing preserves inherited attribution, license and fork lineage. Public/unlisted sharing requires a deliberate license and permission acknowledgment for imported or forked material, unknown rights and changed licensing. Pending copy operations persist across failed responses or downloads; retrying receives the same cloud copy and preserves any existing local edits. Publication attempts also persist their draft fingerprint and operation identifier: a lost response recovers the same immutable version. Changed drafts require explicitly starting a new attempt because the original may already exist. Unlisted retries never restore rotated or revoked access tokens. A deleted or conflicting copy requires explicitly starting a new attempt. See [publishing contracts](docs/publishing-http.md).

Forked areas can check for newer accessible public versions. Discovery excludes private and unlisted versions; an unavailable source needs an explicit author-provided share link. Review the structured differences before creating a separate copy; existing edits and review history remain intact.

## Storybook and screen captures

```bash
pnpm storybook
pnpm screenshots
```

Storybook contains full-screen dashboard stories for desktop and mobile, native mobile client stories rendered through React Native Web, a revealed answer, card media preview and attachment editor, caught-up state, Explore, area editing, Insights, a review-sync conflict, an empty library, AI tutor states, native account deletion confirmation, and publish/review-attribution flows. The component catalog includes package-owned buttons, dialogs, empty states, and status badges with disabled, pending, keyboard focus, error, and recovery mock states, plus study-card states. Stories use deterministic mock data. `pnpm screenshots` opens Storybook headlessly and writes full-page PNGs to [`artifacts/storybook-screenshots/`](artifacts/storybook-screenshots/).

`pnpm test` runs the pure regression and seeded property suite without an app, browser or database. `pnpm check:pure` adds the static gates. `pnpm test:integration` requires explicit local Supabase test credentials; `pnpm check` includes that suite and fails if it is unconfigured. See [verification setup and scope](docs/verification.md); browser/device and release acceptance remain separate.

`pnpm check:static` composes source policy, types, zero-warning lint, formatting, all application builds and the Storybook build. It does not run browsers, database commands or runtime tests. Full release acceptance still requires the report’s test and deployment gates.

See the [implementation completion audit](docs/implementation-audit.md) for source evidence and the remaining verification, activation and release gates.

## Current scope

- Next.js App Router and strict TypeScript workspace
- IndexedDB browser workspace persistence, with validated adoption of legacy localStorage snapshots, so the study loop works without an account or network after the app loads
- FSRS review scheduling through `ts-fsrs`
- Versioned Knowledge Area JSON and bounded ZIP package import/export with verified image/audio media, CSV/TSV card interchange, and private ZIP workspace backup/restore including review history, schedules, and attachments. Imports migrate the [documented Knowledge Area 0.9.0 shape](docs/knowledge-area-schema.md) to 1.0.0; unknown schema versions are rejected.
- CSV/TSV imports accept up to 500 card rows and 200 distinct objectives per area. Titles must fit 80 characters; output passes both local and portable Knowledge Area validation before acceptance.
- Authenticated account JSON export combining paged owner-scoped cloud records with the browser-local workspace
- Shared Effect account operations validate exports and deletion acknowledgments across clients; local cleanup follows a validated server deletion response.
- Portable Knowledge Area exports omit personal review history and schedules; private workspace backups include local review history and schedules
- Effect Schema validation for saved workspace and imported content
- Effect application use cases for review transitions and workspace persistence, backed by a typed local-store port and browser adapter
- Shared Effect area/card create, edit, and delete operations validate commands and retain private schedules, review history, provenance, and sync tombstones. Card content is checked before storing a new attachment.
- Versioned local workspace snapshots with migration from existing unversioned data
- Shared versioned Effect contracts validate workspace snapshots and content synchronization across web, Electron, and mobile
- Optional Supabase Auth email-link sign-in and cookie-based server sessions
- Credential-ready website Sign in with ChatGPT and explicit account linking; eligible desktop distributions can use local ChatGPT plan inference. See [configuration and supported flows](docs/sign-in-with-chatgpt.md).
- [Versioned publishing contracts](docs/publishing-http.md), bounded per-process API abuse limits and opt-in sanitized [HTTP operation logs](docs/http-operations.md)
- Optional server-side AI tutor with structured question, answer-evaluation, and card-proposal outputs
- Hosted and desktop plan tutors use the same framework-independent Effect workflow for session eligibility, provider dispatch, validated outputs, quiz transitions, bounded context and observation history, and pending proposals. Authentication, quotas, usage metering, and persistence adapters are composed at client boundaries.; [task routing and enforced output budgets](docs/task-model-routing.md)
- [Tutor privacy controls](docs/tutor-privacy.md): confirmed transcript/evidence erasure preserves cards and reviews, with configurable inactive-session retention and a protected cleanup endpoint scheduled daily by the web Vercel configuration (`CRON_SECRET` required)
- Tutor inference uses up to the latest 40 chronological question/answer/feedback messages within a 48 KiB encoded history budget. Hosted sessions query that bounded window without deleting private history; desktop plan sessions retain their transcript separately from the window. Quiz state and up to 100 recent observations remain separate. This is deterministic windowing, not an AI-generated session summary; earlier details are not sent to the model. Existing local sessions retain only the messages saved by their previous version.
- Deterministic objective gap signals from card coverage, due schedules, and repeated Again ratings, plus private targeted quizzes with persisted tutor feedback
- Private AI request and token metering with an atomic per-account limit of 30 requests per UTC day
- Explicit learner approval durably saves the card locally before acknowledging the proposal. Retries reuse its identity and preserve existing edits, schedules and tutor provenance; save failures leave the proposal available.
- Initial Supabase schema with private review history and owner-scoped row-level security
- Responsive Today, Explore, and Insights views
- Today counts reviews from the current local calendar day. Insights separates lifetime practice from the last seven calendar days and shows Again/Hard/Good/Easy counts from review history.
- Expo mobile client with SQLite workspace persistence, SecureStore email sessions, shared FSRS scheduling, offline review flow, and authenticated sync
- Electron desktop client with shared study UI, sandboxed renderer, sender-validated IPC, main-process SQLite workspace persistence, OS encrypted email-link sessions, and a main-process bearer-token API proxy
- Create, rename, recolor, and delete learning areas; deleted areas retain their append-only review history
- Edit area metadata, learning objectives and prerequisites, and tutor/quiz/card-generation instructions from Explore
- Browse and search every card, including scheduled cards; edit objective links, tags, and attachments
- Study with Space/Enter to reveal and 1–4 for Again/Hard/Good/Easy; shortcuts pause in forms and dialogs
- Set target retention between 70% and 97% in Insights. It applies to future reviews; each event records its pinned FSRS parameter set so sync can replay historical settings. Preferences stay private and are included in workspace backups.
- Create and edit Cloze cards with numbered deletions and optional hints. Portable JSON/ZIP imports expand unspecified deletion numbers into independent study cards; exports retain original Cloze text and the selected deletion number.
- Compare a shared publication with your fork before creating a new personal copy, including card/objective changes and metadata
- Open public or unlisted sharing links directly in the receiving flow, including with an empty library
- Generate an approved card proposal from eligible quiz feedback, as well as ordinary tutor feedback
- Tutor gaps combine review signals with accumulated quiz evidence; a later correct answer preserves earlier weak findings, while uncertain AI feedback does not create a gap. Reopening a session restores its latest 100 validated observations.
- Imported and forked objectives retain upstream provenance while tutor gap actions target the learner's current objective IDs.
- Web and Electron share framework-independent buttons, dialogs, empty states, status badges, and their styles through `@recall/ui-web`. The source-owned [shadcn/Radix foundation](docs/adr/0006-web-ui-foundation.md) supports composed links and a semantic Tailwind theme.
- Native clients share React Native buttons, status badges, and empty states through `@recall/ui-native`; Storybook includes full-screen action, caught-up, and offline mock states.

The repository's deep research report describes the wider target architecture. Tutor sessions, typed observations, and card proposals persist privately in Supabase and can be resumed on the current device. AI token usage and a 30-request daily account quota are implemented; all 13 local database migrations and generated database types are in place, while runtime RLS checks, authenticated usage validation, and broader cross-device conflict validation remain. Desktop supports local study, encrypted sign-in, authenticated API access, and a main-process SQLite media store; signed packaging and device-level runtime validation remain. Web and mobile support local image/audio attachments, hash-verified media ZIP packages, and private workspace backups that preserve local review history, schedules, and media. Full-screen media editing, review, publishing, token lifecycle, and Anki import states are captured in Storybook, with screenshot capture included in CI. Browser SQL.js, Electron `node:sqlite`, and Expo SQLite adapters now read Anki Basic/Cloze cards and bounded revlog history from legacy `collection.anki2`, uncompressed `collection.anki21`, and normalized v18 `.anki21b` collections; modern field/deck/notetype rows are normalized through a shared decoder. The importer decompresses and validates `.anki21b` media with bounded Zstandard and protobuf decoding. Imported review logs append as review events and rebuild FSRS schedules; Anki intervals/due dates and broader template variants remain unsupported. Web sharing publishes verified image/audio media and creates persisted independent forks; shared Electron/mobile publication transports and a native mobile publishing panel use the shared client, with server-backed token rotation/revocation. Runtime native validation remains.

## Useful commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm build-storybook
pnpm screenshots
pnpm policy
```

GitHub Actions runs the policy scan, typecheck, lint, formatting check, production build, and Storybook build on pushes to `main` and pull requests.

`pnpm lint` applies type-aware strict TypeScript rules to all three apps and shared core packages. The scheduler's use of ts-fsrs v5's deprecated `elapsed_days` field is narrowly exempted in package lint configuration because the current scheduler API still requires it; migrate that adapter when upgrading to v6.

Shared layer ownership and allowed imports are documented in [architecture](docs/architecture.md); [sync protocol](docs/sync-protocol.md) describes coordination, event ordering and explicit conflict resolution. Design tokens have a canonical JSON source; `pnpm tokens:write` generates immutable TypeScript and web CSS variables, and `pnpm tokens:check` prevents drift.

Web and native synchronization now use a shared Effect coordinator and reconciliation operations; platform adapters provide authentication, HTTP, media storage and explicit time/ID generation.

Cloud synchronization saves the verified canonical account identity before uploading content, media or reviews. A workspace bound to a different account stays available for offline study and export; starting a separate workspace requires explicitly clearing local data. Older synchronized workspaces without an account binding require an ownership confirmation. Sync requests carry the expected account identity so a sign-in change cannot redirect an upload to another account.
