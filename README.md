# Recall

For Vercel, Render, Supabase and Redis setup, see [free hosting](docs/free-hosting.md).

Recall is a spaced-repetition learning app with web, Expo mobile and Electron desktop clients. All three share learning areas, card authoring, FSRS reviews, sync, AI tutoring with approved proposals, interchange and publishing; mobile and Electron also support local-only offline study.

The [source layout guide](docs/source-layout.md) maps the feature folders, package entry points, and nested test suites.

Web, Electron, and mobile share study-tool, activity, deck-update, and library-note workflows through `@recall/react`. Pure scheduling, settings drafts, search commands, and queue-aware subject selection live in `@recall/application`. Review-all navigation skips subjects with no eligible cards; presets copy the values currently shown in the settings draft.

## Run locally

Requirements: Node.js 22 and pnpm 10. Mobile and Electron local study do not require an account, environment file, Supabase service or OpenAI credential. The web app shell is available without an account; reading, creating, and studying cards requires configured account and API services.

```bash
pnpm install
pnpm dev
pnpm dev:mobile
pnpm dev:desktop
```

Run each client command in its own terminal. Both desktop development launchers ensure the Electron executable is installed before starting; the first launch may download it, and later launches reuse it. The web app shell is available without an account; card and study features require sign-in and save data through the server. The browser keeps only a temporary working copy in tab memory. Mobile and Electron support local-only study with SQLite, with optional account sync.

To run a client together with the ASP.NET backend, use one of these combined launchers instead of starting the client separately:

```bash
pnpm dev:api:next
pnpm dev:api:desktop
pnpm dev:api:mobile
```

Each launcher starts the .NET 10 API, waits for `/health`, and then starts its client. `pnpm dev:api:next` also starts local Supabase when web account credentials are absent and Docker is available; it stops that Supabase stack on exit if it started it. If local Supabase was already running, the launcher leaves it running. Press Ctrl+C or close the terminal to stop the API, client and any Supabase stack started by the launcher. Optional backend-only settings go in the ignored root `.env.backend.local`; hosted Supabase settings can go in `apps/web/.env.local`. For a physical phone, set `EXPO_PUBLIC_RECALL_API_URL` to the development computer's LAN address, for example `http://192.168.1.20:5000`; the mobile launcher binds the API to all interfaces by default.

| Local application | Command                | Storage                |
| ----------------- | ---------------------- | ---------------------- |
| Web               | `pnpm dev`             | Account server         |
| Desktop           | `pnpm dev:desktop`     | SQLite                 |
| Mobile            | `pnpm dev:mobile`      | SQLite                 |
| Web + ASP.NET API | `pnpm dev:api:next`    | Account server         |
| Desktop + API     | `pnpm dev:api:desktop` | SQLite + API           |
| Mobile + API      | `pnpm dev:api:mobile`  | SQLite + API           |
| Mock screens      | `pnpm storybook`       | Deterministic fixtures |

The web workspace opens at `/subjects`; `/` redirects there. Subject activities use
`?area=<id>&mode=overview|review|tutor|improve`. Electron retains the same context in
local hash routes (`#/subjects?...`). Browser back/forward navigation preserves the
selected subject and activity. Existing `/today`, `/library`, `/tutor` and practice
links remain supported.

## Offline use and optional services

Home combines the daily review queue and complete subject collection. **New subject**,
**Import cards**, and **Browse shared decks** sit together at the top. **Review all due**
works across subjects. The list can be filtered by name and sorted by daily priority,
name, recently studied, or due count. Daily priority puts scheduled reviews first,
ordered by overdue urgency, followed by suggested follow-up work and caught-up subjects.
The sidebar contains Home, subject shortcuts, and Account. Its logo opens Home, and
sidebar collapse has its own control.

Each subject row offers **Review**, **Tutor**, and **Improve** directly. The subject name
opens **Overview**, with cards, materials, and subject-specific progress. A top-right
activity selector switches between Overview, Review, Tutor, and Improve. Tutor provides
an open conversation. Tutor and Improve use a full-height chat room with a scrolling transcript
and a message composer anchored at the bottom; Enter sends and Shift+Enter adds a line on web and desktop.
Improve is a chat: describe what to work on, ask for cards directly, or say you do not know
to get an explanation and a card proposal. The agent probes practical experience and deck coverage, and proactively suggests cards when
uncertainty or gaps emerge. Proposed cards appear as compact previews with Add card, Edit,
and Discard actions. Quiz answers and assessments are optional;
chat requests are never graded automatically. Approve card proposals inline. Materials stay in Overview. Existing investigations resume in the
conversation while that visit is open. Tutor and Improve start fresh each visit; chat
transcripts and unapproved chat proposals stay in memory and are not restored. Approved
cards remain in the deck. Materials and saved notebook investigations retain their storage behavior.

Create an empty subject with just a name, then add cards or materials, or start with AI.
Imported/shared card collections still use the term deck. AI proposals require explicit
approval individually or as a selected batch. Batch approval saves sequentially and
stops on failure, leaving remaining proposals pending. Duplicate consent remains required.
Account contains workspace backups and workspace data/review settings. Mobile follows
the same subject-first activity structure using native controls.

Review screens show session counts, remaining new/learning/review cards, rating guidance,
and deterministic next-review previews using the current retention setting. Session
counts are temporary; returning to the same subject retains the current session. Review history remains
append-only. Empty decks, decks already caught up, and completed sessions have separate
messages. Completion shows this session’s recall results and the next scheduled review,
with a shortcut to another due deck. Cards can become due again during a session.

Library shows a deck overview with due counts and next review dates. Card and deck
editors retain incomplete drafts and confirm before discarding edits. Web drafts and
attachments survive navigation within the current tab; mobile drafts persist locally.
Drafts and review flags are private device preferences and are excluded from sync,
publications, and workspace backups. Failed saves retain edits and offer a retry.

Select multiple cards to add tags, move, or delete them in one atomic operation. Moving
preserves card identities, schedules and review history while matching destination objectives.
Deleted content remains recoverable in **Deleted cards**. Review cards offer **Improve later**; session
completion opens flagged cards in Library for editing. Saving an edit clears its flag.

Library offers **Learning activities** alongside ordinary reviews: multiple choice, short
answers, structured interrogation, and coding exercises. Activities can also wrap existing
Basic/Cloze cards. Create or edit an activity, answer its prompts, review the proposed
assessment, and explicitly accept it to record an attempt. Edit revisions and archived
activities preserve all earlier attempt snapshots. Activity drafts and unfinished attempts
can be saved and resumed. Objective evidence shows dimensions, self reports, assistance,
and observed independent scores; recommendations suggest the next activity and estimated
effort. These estimates do not claim mastery or automatically change FSRS schedules.
Home prioritizes subjects with scheduled reviews, then subjects with recommended follow-up work.
Learning activities remain available in each subject’s card workspace; unfinished attempts
can be resumed there.

Multiple choice uses exact-match grading. Rubric-based activities support self-assessment
and hosted AI assessment using the existing provider, quota, and token-budget adapters.
Structured interrogation progresses through approved stages with up to ten questions in total,
including AI follow-ups; learners approve each follow-up before answering it. Responses,
activity payloads, and rubrics are untrusted content. Provider results are validated and
remain proposals until accepted. Revising after feedback or revealing a reference records
assistance. Uncertain or unavailable assessment preserves work without recording a failure.

Coding exercises accept a synchronous JavaScript `solve` function and declarative JSON
tests (`input` argument arrays and `expected` JSON values). **Run tests** executes only on
the server, inside a read-only Docker container with no network, reduced privileges, memory,
CPU, process, execution-time, and output limits. The trusted test harness remains outside
the learner VM. Tests provide evidence for those cases, not a complexity proof. Build the
runner image with `docker build -t recall-code-runner:1 apps/web/code-runner`; deployments
need Docker and that image (override with `RECALL_CODE_IMAGE`). This runner supports only
synchronous JavaScript and JSON inputs/outputs; it does not install dependencies, support
other languages, or prove complexity. Hosted AI uses the API server's existing
`OPENAI_API_KEY` and tutor model configuration. Runner and AI failures leave the response
available for retry or self-assessment.

Signed-in web activities persist in owner-scoped cloud storage. Native activities persist
locally and **Synchronize activities** merges them with the account copy; hosted operations
use bearer authentication through the general API. The ASP.NET API serves activity reads,
writes, questions, and assessments. Activity definitions can be included in published
releases, while attempts, answers, evidence, schedules, drafts, and unfinished work remain
private. Server validation bounds activity libraries and writes; AI assessment output stays
a proposal until the learner accepts it.
Private workspace backups and account exports include activity content, attempts, and
drafts. Accepted attempts are append-only and idempotent; synchronization detects conflicting
content revisions rather than silently replacing them. Preserve a private backup before
resolving conflicting edits; retry synchronization after a transient failure. The initial schema is split into six ordered files in `supabase/migrations/`, starting with
`20261003000000_initial.sql`, and includes activity storage and hardening. Apply the chain with `pnpm exec supabase migration up --local` for a fresh
local database. It enforces bounded
libraries, account-owned deck references, immutable attempts, and monotonic content
revisions at the database write boundary. Cloud writes pass through the fully validated
API route using server-only `SUPABASE_SERVICE_ROLE_KEY`; direct authenticated RPC writes
are disabled. Initialize the database before using cloud activity saves. Demo activities remain in tab
memory. Portable card-only formats still carry Basic/Cloze content; activity libraries are
available in private workspace backups.

Before publishing, **Deck quality** checks duplicate cards, objective coverage, media
references, multiple-choice answers, and coding tests. Blocking findings must be fixed;
warnings remain advisory. Release drafts retain publishing fields separately from an
in-flight publication. Authors can compare the current deck with their last owned release,
review changed cards, objectives, and activities, and declare an optional difficulty.
Public discovery supports language, topic tags, declared difficulty, activity type, and
estimated study time, with sample content before copying. Time estimates describe deck
size rather than a promise about an individual learner's speed.

**Objective evidence** separates independent, assisted, and self-reported performance.
Diagnostics use the latest independent observation for each dimension and suggest targeted
practice when evidence is weak, old, or missing; an earlier weak answer does not permanently
mark an objective as weak after later improvement.

Activity status distinguishes temporary tab storage, device saves, pending account sync,
successful synchronization, and conflicts. Signed-in web users can explicitly enable
**Keep drafts on this device** to retain bounded, account-scoped activity and publishing data
across browser restarts. Demo data remains temporary. Disable retention to remove the
device copy, or use local-data erasure to clear retained copies and preferences. Native
activity drafts use the device database; unavailable synchronization leaves local work
available for retry.

**Portable deck packages** include cards, activity definitions, and verified attachments in
a single ZIP. Export excludes learning history by default. An explicit private export adds
the selected deck's current-card schedules and reviews, activity attempts, and drafts; private files are
marked in their filename. Import shows a preview before adding content as a new copy.
Restoring private history is a separate choice and rejects conflicting identities rather
than overwriting an existing deck. Account credentials and synchronization bindings are
never part of a deck package. Use a full workspace backup when deleted-card history is
needed as well.

Advanced **Plugin tools** validate JSON content against installed plugin implementations,
show platform and assessment capabilities, and require approval before applying a version
migration. Activities from unavailable plugins retain readable fallback content and can be
exported without installing code.

The plugin framework is in `packages/domain/src/learning-activities.ts` and
`packages/application/src/activities/learning-activities.ts`. Trusted composition registers namespaced,
versioned `ActivityPlugin` implementations using `registerActivityPlugins`. Plugins declare
capabilities, validate and present bounded JSON payloads, assess responses through Effect,
and optionally migrate older versions. Shared validation checks evaluator results and
objective identities. Unknown plugin versions retain their content and readable fallback;
imported documents never install executable code. Domain/application packages have no
React or provider dependencies. Web/native renderers, authenticated HTTP services, provider
calls, and code execution are adapters. Historical snapshots never rerun an evaluator.
Plugin authors implement presentation and assessment against validated payloads, declare
supported platforms and assessment methods, and optionally migrate old payloads. Register
implementations at application composition time and provide the appropriate platform UI
and infrastructure adapters. Each evidence item identifies an objective, dimension,
score, confidence, assistance, and assessment method; learner self-reports remain distinct
from independent evidence. Recommendations are deterministic heuristics over accepted
attempts, rather than a calibrated probability of mastery. Custom plugin installation,
debugging, ordering/matching, and worked-problem editors are not bundled in this release.

Subject Overview contains card management, materials, and progress. The card library keeps search
and filters in one toolbar; **Learning activities** opens exercises in a separate dialog,
with raw plugin authoring under **Advanced activity tools**. Exercise drafts remain available
when that dialog closes. Improve keeps
investigation and card proposals in its conversation. Sources, history, and advanced
settings remain expandable in Overview. Switching activities preserves drafts and pending work.
Card editors keep objectives, tags and attachments under **Card details**; area settings
keep AI instructions and objective prerequisites expandable.

**Search** finds local cards, areas, objectives, concepts, study materials and passages,
study topics, saved tutor answers and pending suggestions. On mobile, open **Search everything**
in subject Overview. Remote conversations that have not been stored locally are not searchable offline.

Card editors and AI approvals flag exact matches, similar wording and conflicting answers;
review the matches before choosing **Keep both**. Library also offers a duplicate scan.
These checks use local text comparisons and do not guarantee semantic equivalence.

Card history records edits, replacements and deletions from this version onward. Compare
earlier content and restore it from Library; **Deleted cards** also recovers cards from deleted
areas. Restoring an active card preserves its schedule and reviews. Recovering a previously
connected deletion creates a fresh copy to preserve sync deletion records. History and its
attachments are included in private workspace backups, and are excluded from shared area files.

Mobile and Electron support local authoring, study, attachments, imports, exports, backups and insights with device storage. The web app shell is available without authentication; card and study features require a reachable signed-in account and sync changes to the account service. It keeps a tab-memory working copy. Cloud publishing and hosted AI also require server configuration.

The normal web build (`pnpm build`) includes its install manifest and cached application shell. The shell contains build-owned static assets only; reading or changing cards requires a reachable account server and workspace data is not cached for offline use. The same build also produces a static entry at `apps/web/public/index.html`; serving it requires an API proxy for account and study features. Hosted API and auth requests are served by the .NET 10 backend and can be routed through the Next.js same-origin proxy with `RECALL_API_URL`; see the [backend setup](backend/README.md).

Desktop and mobile package their application code and SQLite storage, so local startup and learning operations need neither a Recall server nor a development server. Optional authentication and sync run independently from local startup. Being signed in does not make local study depend on the network.

Electron and React Native keep Recall account sign-in optional and separate from AI provider access. On Electron, open **Account settings → AI connection** to connect ChatGPT without creating or signing in to a Recall account, even with an empty library. The desktop tutor shows a **Sign in with ChatGPT** button with the ChatGPT logo when disconnected or after a session expires; it reuses the saved account registration and opens browser sign-in directly. Recall sign-out leaves that connection intact; use the ChatGPT controls to disconnect AI access. Web study still requires a Recall account. React Native also exposes a separate ChatGPT connection in Account on native builds, using a device-local callback listener and protected credentials. Expo Go does not include this module.

AI inference requires a network connection. Direct ChatGPT plan tutoring is enabled in desktop builds by default; no build flag or Recall account is required. OpenAI's documented local authorization flow requires a loopback HTTP listener; native mobile sign-in implements that callback directly rather than using a custom app redirect. Mobile tutoring also supports direct ChatGPT plan requests with on-device credentials and SQLite sessions. Choose ChatGPT plan or Recall hosted in Account → ChatGPT connection; hosted tutoring remains a separate Recall service and is never selected automatically after a ChatGPT failure. See [OpenAI's local sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

With a ChatGPT account and model selected and plan tutoring enabled, the desktop Tutor also offers **Research a topic**. Enter a question to request OpenAI web search using that account's ChatGPT plan, without a Recall server or API key. Completed answers include clickable provider citations. Search availability depends on the selected model and account/workspace policy; unsupported requests show an explanation instead of switching to hosted billing. Research results are separate from the deck and quiz context and do not automatically create cards or change your learning material. See [documented plan capabilities](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

Desktop ChatGPT calls have no local daily, weekly, research or session request caps. Provider token counts are recorded when available without storing prompts or answers. ChatGPT's usage settings show the provider's usage and limits. See [local usage details](apps/desktop/README.md#local-budgets-and-usage-framework).

Storybook includes full-screen mock screens for all three clients. Screenshot targets are registered; running the screenshot command launches a browser, so it is separate from local development.

Turborepo coordinates workspace checks and builds. `pnpm typecheck` checks every shared package and app independently; `pnpm lint` checks all authored source. `pnpm build`, `pnpm build:desktop`, and `pnpm build:mobile` compile one client, while `pnpm build:all` compiles all three. See the [task graph decision](docs/adr/0004-workspace-task-graph.md) for cache boundaries and source dependencies.

Open <http://localhost:3000> for web (with configured account and API services), or use the Expo QR code from `pnpm dev:mobile` on a device. `pnpm dev:desktop` starts the Electron client with the shared study UI and main-process SQLite workspace storage. Desktop email-link sessions are encrypted with Electron `safeStorage`; bearer tokens stay in the main process, which proxies authenticated sync and tutor/account requests through a fixed endpoint allow-list. Desktop cloud features are disabled when Supabase is unconfigured or the OS does not provide encrypted storage. Electron and mobile sync hash-verified private media referenced by shared Knowledge Areas alongside content; native clients use SQLite. Web keeps media only in tab memory until the account service confirms sync. Mobile saves its workspace, review history, and media in SQLite, supports email-link sign-in and bearer-token sync, and requires approval before loading a conflicting server version. Native JSON/ZIP import remaps portable Knowledge Areas; ZIP packages preserve verified media while excluding private schedules and review history. The native account panel supports cloud account export, confirmed account deletion, sign-out that preserves offline data, and private backup export and restore. Deletion clears the device workspace, attachment store, and associated tutor-session links after the cloud deletion succeeds. See [`apps/mobile/README.md`](apps/mobile/README.md) for setup. Device-level validation remains in progress.

For mobile sign-in and sync, copy [`apps/mobile/.env.example`](apps/mobile/.env.example) to `apps/mobile/.env`. On a physical device, set both service URLs to hosts reachable over the local network; `localhost` points to the device itself. See [`apps/mobile/README.md`](apps/mobile/README.md) for redirect and email-template setup.

Build a local unpacked desktop bundle with `pnpm package:desktop`. Native release artifacts can be built on their target operating systems with `pnpm --filter desktop dist:linux`, `dist:mac`, or `dist:windows`. These commands do not sign or notarize installers; production distribution still needs platform signing credentials and release configuration.

## Supabase and account sign-in

Browser study requires this account setup. Mobile and Electron can remain local-only. Install Docker Desktop or another Docker-compatible runtime, then start local Supabase services:

```bash
pnpm supabase:start
```

Web account sign-in supports Apple and Google through Supabase OAuth, plus direct ChatGPT sign-in when its SIWC configuration is enabled. Configure Apple and Google OAuth credentials in Supabase and register Supabase Auth's callback URL with each provider. ChatGPT sign-in needs the SIWC client and durable identity store described in [ChatGPT sign-in setup](docs/sign-in-with-chatgpt.md). Password sign-in is not offered. See the [Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google) and [Apple provider setup](https://supabase.com/docs/guides/auth/social-login/auth-apple).

For local development, `pnpm dev:api:next` starts local Supabase automatically when no Supabase credentials are configured and Docker is available. Google OAuth is configured locally in `supabase/config.toml`; keep its client secret in the ignored root `.env` as `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`. Register `http://127.0.0.1:54321/auth/v1/callback` as an authorized redirect URI for the Google OAuth client, and `http://localhost:3000` as an authorized JavaScript origin. To manage Supabase separately, run `pnpm supabase:start`, copy its API URL and publishable key into `apps/web/.env.local` using [`apps/web/.env.example`](apps/web/.env.example) as a template, and then start the API with `dotnet run --project backend/Recall.Api --urls http://localhost:5000`. The ASP.NET process needs `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in its own environment; `.env.backend.local` is the optional server-only configuration file.

For account deletion, also set `SUPABASE_SERVICE_ROLE_KEY` to the project's server-only service-role key. Never use this key in a `NEXT_PUBLIC_` variable or expose it to browser code. Deletion is disabled when this key is missing; the owner-scoped erasure function removes account records before the Supabase Auth Admin API removes the identity. Users must type `DELETE` to confirm. Web and Electron account controls support export and deletion. Device cleanup drains active storage writes, blocks further writes and stale workspace updates, and clears the local workspace, attachments, and tutor-session links. If cloud deletion succeeds but device cleanup fails, the device stays read-only and offers a cleanup retry. Clearing saved data reloads a fresh workspace only after all local cleanup succeeds.

Web workspaces are loaded from and synced to the authenticated server. An open tab keeps a temporary working copy while changes sync; keep the tab open until the sync status confirms completion. Use account export or a downloaded backup for a durable copy.

Web and Electron keep a rated answer visible until its review event and resulting schedule have been saved. Rating controls lock immediately to prevent duplicate taps or keyboard input. On web, the review syncs to the account server; on Electron, it saves to SQLite and then syncs. A failed save offers an explicit retry of the same immutable review attempt; other workspace writes pause until it commits. The retry remains available when changing views.

Deleting a card or area retains the minimum content needed for pending reviews until the server confirms deletion. Deleted items remain absent from the library and study queue. If content conflicts with another device, review the server version before resolving the conflict. Reviews and other content are never discarded automatically.

AI tutoring is optional. To enable it with ASP.NET, set server-side `OPENAI_API_KEY` and optional model settings in the API process environment; neither value is exposed to the browser. Tutor requests require a signed-in account. Area instructions and imported learning content are sent as untrusted prompt data. AI proposals enter the study deck only after the learner approves them.

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

Creating, renaming and deleting web library content syncs to the account server automatically. Until the server confirms, the current tab holds the working copy; keep it open and retry if sync reports an error. Electron continues to save changes locally before sync.

Web and desktop JSON/CSV/TSV imports retain the parsed content for retry when saving fails and report success after persistence. Mobile also imports/exports CSV and TSV through its file picker and share sheet. Mobile navigation separates Today, Library, Tutor, Sharing and Account while preserving open drafts. Desktop published links open in the default browser, and its trusted dashboard can copy share links.

Hosted AI can enforce optional daily admission budgets through durable Redis, with atomic in-flight reservations and verified usage settlement. See [daily budget configuration](docs/task-model-routing.md#daily-hosted-budgets). These conservative admission units do not promise an exact provider billing cap.

Website sign-in keeps first-party session credentials in HttpOnly, SameSite=Lax cookies, with Secure cookies in production. The web and desktop Account menu opens separate Account settings and Device settings dialogs. Account settings contains data export, deletion, sign-out, and AI budget controls. Account controls read verified status from the server; signing out closes web study access, while mobile and Electron preserve offline study data. [Sign in with ChatGPT setup](docs/sign-in-with-chatgpt.md) includes the OpenAI client request and activation steps; eligible desktop distributions also support local ChatGPT plan tutoring.

Set the issued token-endpoint authentication method explicitly; temporary sign-in outages offer retry or email recovery. Desktop ChatGPT credentials remain in the main process, and plan tutoring requires explicit consent.

Large decks use [deterministic tutor context selection](docs/tutor-context-selection.md), with the selected card count displayed in the tutor panel. Hosted mode requires large areas and their latest changes to be synchronized before starting a session; local ChatGPT mode preserves its full local snapshot. Context-size failures and API funding failures have separate recovery messages.

Native tutor proposal review supports editing the Basic question, answer, learning objective and rationale before approval. Invalid drafts and local save failures retain edits; acknowledgment retries use the exact durable card without overwriting it.

Tutor approval saves the local card before acknowledging the server proposal. If its immutable revision already synchronized, the server verifies ownership, approved content and session/proposal provenance before linking that revision; this repair requires the server-only `SUPABASE_SERVICE_ROLE_KEY`. Later revisions use the existing insert trigger. A failed repair leaves the proposal available to retry and preserves the durable local card. Session restore also retries unlinked approved proposals, up to 100 per request; failures or excess backlog return unavailable instead of hiding incomplete recovery.

For a hosted Supabase project, configure the site URL and redirect allow-list with both the web `/auth/confirm` URL and `recall://auth/confirm`, then set the Magic Link email template to link to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`. Configure the Next.js server's `RECALL_API_URL` as the ASP.NET upstream when using its browser proxy. Set the Electron release's `RECALL_API_URL` and Expo's `EXPO_PUBLIC_RECALL_API_URL` to the reachable HTTPS API origin or gateway. Configure SMTP before sending production email.

See the [deployment runbook](docs/deployment-runbook.md) for staging and production setup, release gates, deletion operations, and incident steps. The [threat model](docs/threat-model.md) summarizes sensitive data, trust boundaries, current controls, and security gaps.

The database migrations create owner-scoped learning content and private, append-only review history. Published Knowledge Area snapshots have a separate immutable table with public reads and token-gated unlisted reads; snapshots carry attribution, license, and fork-lineage metadata without learner state. Web supports publishing verified image/audio media through a private Supabase Storage bucket, public/unlisted media reads, and reviewing attribution/license before forking a remapped local copy with fresh scheduling state. Owners can rotate or revoke unlisted links; only token hashes are stored. Shared Effect publishing and media gateways have web, Electron IPC, and mobile bearer-token transports. Native publishing/fork screens are implemented; device-level validation remains open. Row-level security is enabled for every application table. `pnpm policy` checks the source restrictions and migration RLS/privilege declarations; it does not replace running database policy tests. `pnpm supabase:types` regenerates the browser/server database types from the running local schema. `pnpm supabase:reset` rebuilds the local database from migrations and is destructive to that local database.

Publishing preserves inherited attribution, license and fork lineage. Public/unlisted sharing requires a deliberate license and permission acknowledgment for imported or forked material, unknown rights and changed licensing. Pending copy operations persist across failed responses or downloads; retrying receives the same cloud copy and preserves any existing local edits. Publication attempts also persist their draft fingerprint and operation identifier: a lost response recovers the same immutable version. Changed drafts require explicitly starting a new attempt because the original may already exist. Unlisted retries never restore rotated or revoked access tokens. A deleted or conflicting copy requires explicitly starting a new attempt. See [publishing contracts](docs/publishing-http.md).

Forked areas can check for newer accessible public versions. Discovery excludes private and unlisted versions; an unavailable source needs an explicit author-provided share link. Review the structured differences before creating a separate copy; existing edits and review history remain intact.

Shared decks have a public catalog, owner management, correction feedback, and per-copy follow subscriptions. Sharing is public publication or an unlisted exact-version link; there are no invitations or named viewer grants. Owners can withdraw remote access while retaining their history; downloaded copies remain personal content. Following a deck preserves its original fork lineage and never overwrites local edits. The updates inbox shows newer public releases and supports explicit read acknowledgment. Learners can review card, objective, and activity definition changes before applying them; review history and schedules are preserved. Learners can report releases or block publishers. Operators use the server-only comma-separated `RECALL_MODERATOR_USER_IDS` UUID allowlist to review reports and hide or restore decks; actions append to the moderation audit. Initialize a fresh Supabase project with the complete ordered migration chain before enabling the API routes (`pnpm exec supabase migration up --local` for a local stack). The ASP.NET server needs `SUPABASE_SERVICE_ROLE_KEY` for immutable publication registration and moderation; keep it server-only. See the [sharing HTTP contract](docs/publishing-http.md) and [backend setup](backend/README.md#shared-deck-storage).

## Internal assessment model

The shared domain names repeatable learning exercises `Assessment`, with
`AssessmentId` identities and `AssessmentSchedule` scheduling state. Portable
`AssessmentContent` is a discriminated union of the current flashcard (`basic`)
and cloze formats. The UI still calls these formats cards, and Anki terminology
remains specific to Anki imports and exports.

Existing serialized `cards` and `cardId` fields, API commands and database names
retain their current format so saved workspaces, backups and review history remain
compatible. The internal rename does not require a data migration.

Extensible exercises use the separate versioned `LearningActivity` envelope and plugin
registry described above. Their accepted `LearningAttempt` snapshots preserve the content
revision, response, evaluator identity/version, feedback, and objective evidence. Existing
card formats and review commands remain compatible; activity evidence does not silently
replace a learner's FSRS rating. `NotebookAssessment` remains the Tutor notebook's separate
summary of evidence about a concept, rather than a scheduled exercise.

## Adaptive assessment and the knowledge notebook

Quick questions probe weak understanding shown in recent answers and relevant gaps
between learning objectives and supplied card coverage. Prompts direct the tutor to
avoid copied or lightly reworded card questions and use explanation, comparison,
prediction and new applications. Without learner evidence, questions explore possible
gaps rather than assume a weakness; missing cards alone do not show poor understanding.

The Tutor includes a private, device-local knowledge notebook. Choose a learning goal
then investigate the topic one question at a
time. Existing objectives seed its concept map; topics without objectives start with
one broad concept. Add subtopics yourself or explicitly accept suggested subtopics.

The notebook records actual questions, answers, learner confidence, provider feedback,
misconceptions and linked cards. Assessments are provisional: a single answer cannot
establish understanding. Demonstrated understanding requires multiple distinct
successful tutor answers, including an explanation or application question. Review
failures reopen gaps; successful card recall alone does not establish understanding.

The shared harness chooses unassessed concepts, uncertain findings and implicated
prerequisites, then drills down through clarification, prediction, variation,
explanation, application and later revisiting. **Explain first**, **Go deeper**,
**Skip** and **Finish** keep the learner in control. Request admissions are saved
before AI calls, including failed attempts. Interrupted sessions retain pending
questions and evidence. AI uses the existing selected tutor provider; reading the
saved notebook is local, while inference needs a connection and eligible provider.

Generate card proposals from recorded findings individually or as an incremental
batch. Proposals retain their supporting evidence, check exact normalized question
and answer duplicates, and remain editable until approved. Approved cards use the
existing durable card-save and spaced repetition flow. There is no target deck size;
practice continues without local question, request-count or time caps.

The notebook is stored separately from the portable learning-area document and
workspace backup. Export its private JSON record separately. Clearing a notebook
removes its evidence and proposals while keeping saved cards and review history.
Clearing device data also removes notebooks. Research results remain separate and
are not automatically passed into assessments or represented as research the tutor
has performed.

## Study from materials

In the Tutor notebook, paste text or import TXT, Markdown, DOCX and text-based PDF
files (up to 16 MiB). Extraction runs locally. Review and correct the extracted
passages, select sections, then choose a goal, depth and card count. Enable local OCR
for scanned PDFs or import images of notes; encrypted PDFs and legacy `.doc` files
remain unsupported. UTF-8
and UTF-16 text exports with byte-order marks are supported; invalid encodings are
rejected. PDF reading order and DOCX tables or code formatting may need correction.

Extracted text is retained in the private notebook; original file binaries are not
retained. Notebook JSON exports include the materials. Generation sends the chosen
passage, learning goal and relevant learning-area context to the configured AI
provider. Reading materials and reviewing saved cards work offline; AI generation
requires a connection and an eligible provider.

Each generated card uses one budgeted AI request. Batches can be paused, and completed
proposals remain saved. Resumed batches prioritize passages with fewer saved
proposals. Source quotes, section IDs and PDF page references are
validated against the extracted passage. This verifies provenance, not factual
accuracy: review and edit each proposal before approving it into spaced repetition.
Suggested concepts also require approval. Coverage shows where cards were proposed
or approved; it does not claim mastery or complete coverage of a document.

## Card quality, refinement and coverage planning

Card editors and notebook proposals include deterministic quality hints that work
offline: ambiguous wording, missing context, multiple retrieval targets and answer
leakage. Optional AI inspection adds explanations and suggested fixes. Neither
check certifies factual accuracy.

Ask AI to clarify, shorten, split, add an example, convert to cloze, or follow custom
refinement instructions. Compare the original with proposed cards before applying
changes. Notebook refinements remain pending proposals until separately approved.
Library wording updates first enter the editor draft and keep the existing schedule
when saved. Approving replacements creates fresh cards and schedules, retires the
original card, and preserves its review history. Stale edits and failed saves retain
the existing content. Cloze proposals become actual cloze cards on approval.

In study materials, request a coverage outline for each selected passage. Review
the suggested claims and cited quotes, select or skip claims, and set their
priorities. With a plan present, generation targets selected claims without pending
or approved cards, in priority order. Plan further passages to include them; a plan
is a bounded proposal, not an exhaustive document analysis. Coverage records linked
card activity, not mastery or factual verification. Meaning-changing refinements
and splits clear inherited claim links. Plans are stored locally with the notebook
and included in notebook JSON exports.

AI refinement, inspection, planning and generation use the configured hosted or
eligible desktop ChatGPT provider. Local quality
checks, saved plans, card editing and studying remain available offline. No Recall
server is required for eligible desktop ChatGPT plan operations.

## OCR, budgets and daily reminders

**Local OCR:** the study import screen recognizes English scanned PDFs and PNG/JPEG
images; web and Electron also support WebP. Web/Electron bundle their OCR worker,
WASM cores and English model, and the installed web offline cache includes those
assets. Mobile uses on-device Apple Vision/PDFKit and bundled Android ML Kit Latin
recognition. Imported content never goes to an OCR server. OCR can misread code,
tables and formulas: correct the preview before asking AI to generate cards.
Web/Electron imports support up to 30 PDF pages; mobile lets you choose a range of
up to 20 pages. All files are limited to 16 MiB. Mobile OCR requires a rebuilt app,
not Expo Go; native OCR execution still needs device validation.

**AI budgets:** open settings in the desktop ChatGPT panel or signed-in web/mobile
account controls. Set daily/weekly request caps and, for desktop research, a daily
research cap. Blank is unlimited; zero blocks new requests. Saving limits preserves
usage history. Daily periods reset at midnight UTC; weekly periods start Monday
UTC. Pending and failed AI attempts remain counted. Counts apply to this device
and account, independently of provider allowances and optional server limits.
Provider tokens appear when reported; hosted-client token usage remains unknown.
No remaining ChatGPT allowance or monetary spend is inferred.

**Daily reminders:** open Device settings on web/Electron or Account on mobile.
Choose a local time and explicitly enable notification permission. Reminders carry
a generic study message and open Today when tapped. Mobile schedules through the
OS and can notify with the app closed; Focus/battery restrictions may delay delivery.
Browser reminders require an open page and desktop reminders require the app
process running. Unsigned macOS development packages may not deliver native
notifications; a signed app is required for reliable macOS delivery. Disabling a
reminder cancels Recall's schedule, and clearing device data disables reminders.
No push server, Expo account or service credentials are needed.

## Storybook and screen captures

```bash
pnpm storybook
pnpm screenshots
```

Storybook contains full-screen dashboard stories for desktop and mobile, native mobile client stories rendered through React Native Web, a revealed answer, card media preview and attachment editor, caught-up state, Explore, area editing, Insights, a review-sync conflict, an empty library, AI tutor states, native account deletion confirmation, and publish/review-attribution flows. The component catalog includes package-owned buttons, dialogs, empty states, and status badges with disabled, pending, keyboard focus, error, and recovery mock states, plus study-card states. Stories use deterministic mock data. `pnpm screenshots` opens Storybook headlessly and writes full-page PNGs to [`artifacts/storybook-screenshots/`](artifacts/storybook-screenshots/).

`pnpm test` runs unit regression and seeded property checks. `pnpm test:local-integration`
exercises persisted application journeys and real storage adapters with controlled local ports;
neither starts a browser, app server or database service. `pnpm check:pure` includes both and
the static gates. `pnpm test:e2e` builds and serves the offline web application and mock
Storybook screens, then runs Chromium workflows. Install its browser with
`pnpm --filter web exec playwright install chromium`; CI installs it automatically and saves
results and failure diagnostics. `pnpm --filter web test:e2e --check` only checks test syntax,
without builds, servers or browsers. `pnpm test:integration` remains the separate Supabase suite
requiring explicit disposable local credentials. See [verification setup and scope](docs/verification.md).

`pnpm check:static` composes source limits and their checker tests, source policy, types, zero-warning lint, formatting, all application builds and the Storybook build. CI also enforces the 400-line and eight-level indentation limits. It does not run browsers, database commands or application runtime tests. Full release acceptance still requires the report’s test and deployment gates.

See the [implementation completion audit](docs/implementation-audit.md) for source evidence and the remaining verification, activation and release gates.

## Current scope

- Next.js App Router and strict TypeScript workspace
- Authenticated server-backed web workspaces with tab-memory drafts; no browser database or localStorage persistence for web study data
- FSRS review scheduling through `ts-fsrs`
- Versioned Knowledge Area JSON and bounded ZIP package import/export with verified image/audio media, CSV/TSV card interchange, and private ZIP workspace backup/restore including review history, schedules, and attachments. Imports migrate the [documented Knowledge Area 0.9.0 shape](docs/knowledge-area-schema.md) to 1.0.0; unknown schema versions are rejected.
- CSV/TSV imports accept up to 500 card rows and 200 distinct objectives per area. Titles must fit 80 characters; output passes both local and portable Knowledge Area validation before acceptance.
- Authenticated account JSON export combining paged owner-scoped cloud records
- Shared Effect account operations validate exports and deletion acknowledgments across clients; local cleanup follows a validated server deletion response.
- Portable Knowledge Area exports omit personal review history and schedules; private workspace backups include local review history and schedules
- Effect Schema validation for saved workspace and imported content
- Effect application use cases for review transitions and workspace persistence, backed by a typed local-store port and volatile web adapter
- Shared Effect area/card create, edit, and delete operations validate commands and retain private schedules, review history, provenance, and sync tombstones. Card content is checked before storing a new attachment.
- Versioned local workspace snapshots for native clients
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
- Clock rollback and clock-skewed synced reviews preserve their recorded timestamps. FSRS uses a nondecreasing derived review time so live reviews, previews, and causal history replay cannot produce negative elapsed time.
- Review settings now include a workspace-wide daily new-card budget (20 by default), backlog pauses, sibling burying, recall-based review ordering, and a configurable repeated-failure threshold (8 lapses by default). Due learning steps come first; established reviews remain visible when the new-card budget is exhausted. Study days use this device's local calendar.
- Study tools let you suspend/resume cards without deleting history and identify repeatedly failed cards for editing. **Extra practice** revisits a subject without changing due dates, consuming the daily new-card budget, or adding scheduler evidence. Forgotten practice cards return at the end.
- **Personalized scheduling** offers experimental local parameter fitting after at least 100 interday review observations, using all available histories, with a configurable UTC cutoff and cancellable fitting. Earlier answers still establish memory state. Optional due-date recalculation appends scheduling adjustments when parameters change. Independent official FSRS fixtures validate replay and scoring; optimizer convergence equivalence is not established. See [scheduler optimization](docs/scheduler-optimization.md). A proposal must improve validation predictions and be selected and saved before it applies. This conservative fitter is distinct from Anki's optimizer. Historical fitted parameters travel with synced reviews so other clients can replay them; private study preferences, suspensions, collections, corrections and administrative changes synchronize through the authenticated backend with revision checks and explicit conflict resolution. See [the scheduling decision](docs/adr/0003-fsrs-retention-and-replay.md).
- **Subject presets and groups** support inherited settings and parent introduction budgets. **Scheduling adjustments** configure learning/relearning steps, maximum intervals, new/review mixing, interval ordering, and reduced-load weekdays.
- **Extra practice** supports persistent filtered collections across subjects, limits, ordering, saved searches, preview-only answers and explicit rescheduling. Apply a query to scheduled reviews explicitly, then clear it from Study tools. Library search accepts the same card filters. **Manage scheduling** sets due dates, resets cards to new while preserving answers, and repositions new cards.
- **Undo last review** retains the original answer as evidence and appends a synchronized correction, restoring scheduling, daily budgets and statistics. **Card browser** adds card/notes modes, indexed searches by custom fields, note type and template, bounded regular expressions, saved columns, sorting, hierarchical tags, related-card inspection and confirmed source-field replacement with version history.
- **Workload simulator** estimates repeated reviews, failures, study time and backlog across retention targets and introduction/review limits. Experimental parameter fitting uses a temporal holdout, log loss, RMSE and calibration checks. See [study customization](docs/study-customization.md) for bounds and assumptions.
- **Larger collections** support up to 50,000 cards and notes per subject within explicit byte budgets, paged browser rows, chunked local SQLite storage and batched sync. Study metadata transfers only new append-only entries through revision-fenced pages. See [collections and browser](docs/collection-browser.md).
- **Detailed study statistics** show daily activity, measured review time, first-answer retention, due forecasts, memory distributions, and chart values, scoped to all subjects or a subject group. See [study customization](docs/study-customization.md) for usage, search syntax, and sync limitations.
- **Shared notes and templates** provide on-demand card previews and generate related cards from custom fields, including reversed cards and nested cloze deletions. Editing a source regenerates siblings while preserving surviving identities and schedules. Templates can place new siblings in other subjects through canonical source notes and validated destination snapshots; moving cards preserves their identities, schedules and append-only review history. Ordinary cloze cards adopt this model automatically. Field migrations and note-type conversions preview removed data before confirmation. Sticky fields, selection-aware formatting, inline images, conditional templates, safe reusable appearance settings and offline TeX math rendering work across clients. See [note authoring](docs/note-authoring.md) and [rich content](docs/rich-content.md).
- **Image occlusion** creates cards from rectangles, ellipses or polygons, with grouped masks and hide-one/hide-all review modes. Edit geometry against the source image; surviving questions retain review history.
- **Subject hierarchy** supports parent study sessions and intersecting daily review caps, plus today-only overrides. Learning and relearning steps remain available when the established-card budget is exhausted.
- **Reviewer controls** add an optional timer, explicitly started auto-advance, configurable web/Electron shortcuts, opt-in touch swipes and separate new/review/learning sibling bury settings. See [reviewer controls](docs/reviewer-controls.md).
- **Language practice** supports typed answers with case/accent options and visible comparisons, field-specific text-to-speech voices/language/speed, and pronunciation recordings that require approval before attachment. Ratings remain the learner's choice. Native microphone permissions require rebuilding the app.
- **Collection maintenance**, under Manage scheduling → Files, reports missing/corrupt/unused media, empty cards and broken source references. Automatic recovery points retain earlier content and settings; desktop/mobile archives survive restarts while web points stay in tab memory. Restore preserves newer content and append-only review evidence. Confirmed permanent trash cleanup rechecks current content, drafts and recovery points before deleting files. See [collection recovery](docs/collection-recovery.md). Missing-media tags make affected cards searchable.
- These additions require the study migrations (`20261019000000_study_sync.sql`, `20261020000000_authored_cards_and_audio.sql`, `20261023000000_paged_study_metadata.sql` and `20261024000000_atomic_linked_notes.sql`) and the updated backend before deploying clients. Imported schedule baselines remain private append-only metadata; public copies start fresh.

- Create and edit Cloze cards with numbered deletions and optional hints. Portable JSON/ZIP imports expand unspecified deletion numbers into independent study cards; exports retain original Cloze text and the selected deletion number.
- Compare a shared publication with your fork before creating a new personal copy, including card/objective changes and metadata
- Open public or unlisted sharing links directly in the receiving flow, including with an empty library
- Generate an approved card proposal from eligible quiz feedback, as well as ordinary tutor feedback
- Tutor gaps combine review signals with accumulated quiz evidence; a later correct answer preserves earlier weak findings, while uncertain AI feedback does not create a gap. Reopening a session restores its latest 100 validated observations.
- Imported and forked objectives retain upstream provenance while tutor gap actions target the learner's current objective IDs.
- Web and Electron share framework-independent buttons, dialogs, empty states, status badges, and their styles through `@recall/ui-web`. The source-owned [shadcn/Radix foundation](docs/adr/0006-web-ui-foundation.md) supports composed links and a semantic Tailwind theme.
- Native clients share React Native buttons, status badges, and empty states through `@recall/ui-native`; Storybook includes full-screen action, caught-up, and offline mock states.

The repository's deep research report describes the wider target architecture. Tutor sessions, typed observations, and card proposals persist privately in Supabase and can be resumed on the current device. AI token usage and a 30-request daily account quota are implemented; database migrations and generated database types are in place, while runtime RLS checks, authenticated usage validation, and broader cross-device conflict validation remain. Desktop supports local study, encrypted sign-in, authenticated API access, and a main-process SQLite media store; signed packaging and device-level runtime validation remain. Web uses account-backed study data with tab-memory drafts by default and explicit device retention; mobile supports local image/audio attachments, hash-verified media ZIP packages, and private workspace backups that preserve local review history, schedules, and media. Full-screen media editing, review, publishing, token lifecycle, and Anki import states are captured in Storybook, with screenshots captured by the explicit local screenshot command. Browser SQL.js, Electron `node:sqlite`, and Expo SQLite adapters read Anki Basic, reversed, safe static custom-template and Cloze cards with bounded revlog history from legacy `collection.anki2`, uncompressed `collection.anki21`, and normalized v18 `.anki21b` collections. Supported review and timestamp-learning queues preserve due dates and intervals as replayable import baselines; suspended queues and supported native Anki image-occlusion masks also import. Matching GUID/template re-imports preserve existing local schedules and review evidence; unsupported forms fail explicitly. Web, Electron and mobile export `.apkg` collections with shared notes, safe text templates and verified attachments. Exports reset schedules by default, optionally include private scheduling, and genuine review logs when private history is selected; Recall ZIP retains Recall-specific formatting, image masks and presentation preferences. See [Anki interchange](docs/anki-interchange.md) for supported templates, limits and migration semantics. Web sharing publishes verified image/audio media and creates persisted independent forks; shared Electron/mobile publication transports and a native mobile publishing panel use the shared client, with server-backed token rotation/revocation. Runtime native validation remains.

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

## Build and delivery automation

Pull requests and pushes to `main` validate workflow syntax, run local regression checks, source policy, strict type checks, lint and formatting checks, build the web application with offline support and Storybook, and build the following downloadable client artifacts:

| Platform                    | Artifact                                                  | Configuration needed |
| --------------------------- | --------------------------------------------------------- | -------------------- |
| Web                         | Web server archive with installable static shell          | Account/API settings |
| Android                     | Standalone APK signed with a development key; JS embedded | None                 |
| iOS                         | Apple Silicon simulator `.app` archive; JS embedded       | None                 |
| Linux x64                   | Unsigned AppImage                                         | None                 |
| macOS Intel / Apple Silicon | Unsigned DMG and ZIP                                      | None                 |
| Windows x64                 | Unsigned NSIS installer                                   | None                 |

Each `main` commit has its own desktop/mobile packaging run; newer commits do not cancel an earlier artifact build. Upload gates verify the expected desktop installer formats/architectures and embedded mobile JavaScript/native binaries before uploading. Artifacts are retained for 14 days in the matching GitHub Actions run.

The client build workflows do not start Supabase or require service credentials. Optional repository variables supply public endpoint configuration (`NEXT_PUBLIC_*` for web/desktop, `RECALL_API_URL` for desktop, and `EXPO_PUBLIC_*` for mobile). The web archive requires account and API services; mobile and Electron retain local study when those settings are unset. CI builds the web application and uploads one standalone server archive containing its browser assets and static app shell. Start the archive with `node apps/web/server.js` after extraction and configure its API services before signing in. **Local Supabase and backend integration** runs automatically for changes to backend, contracts, migrations, and shared sync/application packages, and can also be dispatched manually. It starts disposable Supabase and verifies real ASP.NET publishing routes. A separate **Backend contracts** workflow builds the .NET solution, checks generated schemas and shared fixtures, and verifies the live Development OpenAPI document. See [the contract bridge](docs/dotnet-contract-bridge.md) for `pnpm contracts:generate`, `pnpm contracts:check`, and the cross-language fixture commands. CI also captures the Storybook catalog for review.

Desktop development and packaged builds include direct ChatGPT authorization by default. Signed desktop and EAS mobile release workflows remain opt-in and require their platform credentials. The default Android APK is for local installation, and the iOS archive is for a simulator; App Store/TestFlight and physical iOS installation require signed releases. Cross-platform workflows must run on GitHub before their resulting installers can be accepted; local source compilation alone does not establish native runtime behavior.

`pnpm typecheck` uses strict TypeScript across all apps and shared packages, including Storybook and TypeScript tooling configurations. `pnpm lint` applies the shared `strictTypeChecked` TypeScript ESLint preset and treats unhandled neverthrow results as errors (`neverthrow/must-use-result`) across `.ts`, `.tsx`, `.mts`, and `.cts` files. Effect remains the application error-handling abstraction. Explicit `any`, TypeScript error suppressions, and inline ESLint configuration are prohibited; lint commands allow zero warnings. `pnpm lint:config` verifies coverage of app, package, Storybook, and tooling files and checks that discarded results and promises are rejected. The neverthrow plugin uses `@eslint/compat` for ESLint 9 compatibility. The scheduler's use of ts-fsrs v5's deprecated `elapsed_days` field is narrowly exempted in package lint configuration because the current scheduler API still requires it; migrate that adapter when upgrading to v6.

Shared layer ownership and allowed imports are documented in [architecture](docs/architecture.md); [sync protocol](docs/sync-protocol.md) describes coordination, event ordering and explicit conflict resolution. Design tokens have a canonical JSON source; `pnpm tokens:write` generates immutable TypeScript and web CSS variables, and `pnpm tokens:check` prevents drift.

T3's `t3.json` commands include **Lint (strict TypeScript and neverthrow)**, **Typecheck**, and a separate **Check file size and indentation** command. Run the latter directly with `pnpm check:source-limits`, or pass source file paths for a focused check, for example `pnpm check:source-limits scripts/check-source-limits.mjs`. It checks tracked and untracked Git-visible source across project languages, including TypeScript/JavaScript, C#, SQL, Swift/Kotlin, Python, styles, HTML, shell, Gradle, and podspecs. Documentation, data/configuration files, generated output, and vendor files are excluded. The limits are 400 physical lines and eight indentation levels; a final newline does not add a line. Indentation counts leading whitespace on every nonblank line, including continuation lines, comments, and literal contents. C#, F#, Python, Java, Rust, and PHP use four spaces per level; other source languages use two, matching the project's TypeScript and native code. Tabs advance to the next indentation stop. The report has separate indentation and line-count sections, each sorted from highest to lowest with filename ordering for ties. Violations report file locations and exit with status 1; existing violations are reported without a baseline exemption. This check is independent of `pnpm lint` and `pnpm check`. Run `pnpm test:source-limits` to verify the checker itself.

Web and native synchronization now use a shared Effect coordinator and reconciliation operations; platform adapters provide authentication, HTTP, media storage and explicit time/ID generation.

Cloud synchronization saves the verified canonical account identity before uploading content, media or reviews. Native workspaces bound to a different account stay available for offline study and export; starting a separate workspace requires explicitly clearing local data. Web workspaces require an account and start from the server snapshot. Sync requests carry the expected account identity so a sign-in change cannot redirect an upload to another account.

Tutor and Improve use a compact chat composer with an in-chat desktop model selector
and a context-window pie. Desktop chat checks the exact request input-token count
before generation and rejects requests above 100,000 tokens. The pie shows measured
input usage for the latest request; its details include response tokens and reported
cache reads/writes. Stable deck data and individual conversation messages retain
separate boundaries for provider prompt caching. No saved chat transcript or local
response cache is introduced. See [context limits and caching](docs/agent-chat-context-and-caching.md)
for request behavior and the ChatGPT plan restriction on output-token limits.
Improve answers direct questions and explanations before asking follow-ups, and
proposes relevant cards as uncertainties emerge. Card editing keeps AI refinement
shortcuts and custom instructions in one collapsible section, with suggested changes
shown before they are applied.

Local migration reconciliation, backup restore and authenticated study API acceptance are documented in [study release validation](docs/study-release-readiness.md).
