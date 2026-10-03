# Recall

Recall is an offline-capable spaced-repetition learning app. The first runnable slice is a responsive web client with local learning areas, cards, and FSRS-scheduled reviews.

## Run locally

Requirements: Node.js 20.9+ and pnpm 10.

```bash
pnpm install
pnpm dev
pnpm dev:mobile
pnpm dev:desktop
```

Open <http://localhost:3000> for web, or use the Expo QR code from `pnpm dev:mobile` on a device. `pnpm dev:desktop` starts the Electron client with the shared study UI and main-process SQLite workspace storage. Desktop email-link sessions are encrypted with Electron `safeStorage`; bearer tokens stay in the main process, which proxies authenticated sync and tutor/account requests through a fixed endpoint allow-list. Desktop cloud features are disabled when Supabase is unconfigured or the OS does not provide encrypted storage. Mobile saves its workspace, review history, and media in SQLite, supports email-link sign-in and bearer-token sync, and requires approval before loading a conflicting server version. Native JSON/ZIP import remaps portable Knowledge Areas; ZIP packages preserve verified media while excluding private schedules and review history. The native account panel also supports explicit private backup export and restore, including local reviews, schedules, and attachments. See [`apps/mobile/README.md`](apps/mobile/README.md) for setup. Device-level validation remains in progress.

Build a local unpacked desktop bundle with `pnpm package:desktop`. Native release artifacts can be built on their target operating systems with `pnpm --filter desktop dist:linux`, `dist:mac`, or `dist:windows`. These commands do not sign or notarize installers; production distribution still needs platform signing credentials and release configuration.

## Local Supabase and account sign-in

Install Docker Desktop or another Docker-compatible runtime, then start the local Supabase services:

```bash
pnpm supabase:start
```

Copy the local API URL and publishable key printed by the CLI into `apps/web/.env.local`, using `apps/web/.env.example` as the template. Restart the web or desktop app after changing environment variables. Local Supabase includes the email template and callback configuration for passwordless sign-in. Emails are captured by the local mail inbox rather than delivered externally. Desktop uses `RECALL_API_URL` to reach the authenticated web API; its development default is `http://localhost:3000`.

For account deletion, also set `SUPABASE_SERVICE_ROLE_KEY` to the project's server-only service-role key. Never use this key in a `NEXT_PUBLIC_` variable or expose it to browser code. Deletion is disabled when this key is missing; the owner-scoped erasure function removes account records before the Supabase Auth Admin API removes the identity. Users must type `DELETE` to confirm. This also clears this browser's local workspace and tutor-session links.

AI tutoring is optional. To enable it, set a server-side `OPENAI_API_KEY` and `OPENAI_MODEL` in `apps/web/.env.local`; neither value is exposed to the browser. Tutor requests require a signed-in account. Area instructions and imported learning content are sent as untrusted prompt data. AI proposals enter the study deck only after the learner approves them.

For a hosted Supabase project, configure the site URL and redirect allow-list with both the web `/auth/confirm` URL and `recall://auth/confirm`, then set the Magic Link email template to link to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`. Set `RECALL_API_URL` to the hosted web API origin for desktop, and configure SMTP before sending production email.

The database migrations create owner-scoped learning content and private, append-only review history. Published Knowledge Area snapshots have a separate immutable table with public reads and token-gated unlisted reads; snapshots carry attribution, license, and fork-lineage metadata without learner state. Client publishing and fork workflows are not wired yet. Row-level security is enabled for every application table. `pnpm policy` checks the source restrictions and migration RLS/privilege declarations; it does not replace running database policy tests. `pnpm supabase:types` regenerates the browser/server database types from the running local schema. `pnpm supabase:reset` rebuilds the local database from migrations and is destructive to that local database.

## Storybook and screen captures

```bash
pnpm storybook
pnpm screenshots
```

Storybook contains full-screen dashboard stories for desktop and mobile, native mobile client stories rendered through React Native Web, a revealed answer, card media preview and attachment editor, caught-up state, Explore, area editing, Insights, a review-sync conflict, an empty library, and AI tutor start, feedback, objective gaps, targeted quizzes with evaluated answers, and proposal states. The component catalog includes action variants, study-card states, and shared status, empty-state, and dialog components. Stories use deterministic mock data. `pnpm screenshots` opens Storybook headlessly and writes full-page PNGs to [`artifacts/storybook-screenshots/`](artifacts/storybook-screenshots/).

## Current scope

- Next.js App Router and strict TypeScript workspace
- Browser-local persistence, so the study loop works without an account or network after the app loads
- FSRS review scheduling through `ts-fsrs`
- Versioned Knowledge Area JSON and bounded ZIP package import/export with verified image/audio media, CSV/TSV card interchange, and private ZIP workspace backup/restore including review history, schedules, and attachments. Unsupported Knowledge Area schema versions are rejected instead of guessed.
- Authenticated account JSON export combining paged owner-scoped cloud records with the browser-local workspace
- Portable Knowledge Area exports omit personal review history and schedules; private workspace backups include local review history and schedules
- Effect Schema validation for saved workspace and imported content
- Effect application use cases for review transitions and workspace persistence, backed by a typed local-store port and browser adapter
- Versioned local workspace snapshots with migration from existing unversioned data
- Optional Supabase Auth email-link sign-in and cookie-based server sessions
- Optional server-side AI tutor with structured question, answer-evaluation, and card-proposal outputs
- Deterministic objective gap signals from card coverage, due schedules, and repeated Again ratings, plus private targeted quizzes with persisted tutor feedback
- Private AI request and token metering with an atomic per-account limit of 30 requests per UTC day
- Explicit learner approval before an AI proposal becomes a scheduled card
- Initial Supabase schema with private review history and owner-scoped row-level security
- Responsive Today, Explore, and Insights views
- Expo mobile client with SQLite workspace persistence, SecureStore email sessions, shared FSRS scheduling, offline review flow, and authenticated sync
- Electron desktop client with shared study UI, sandboxed renderer, sender-validated IPC, main-process SQLite workspace persistence, OS encrypted email-link sessions, and a main-process bearer-token API proxy
- Create, rename, recolor, and delete learning areas; deleted areas retain their append-only review history

The repository's deep research report describes the wider target architecture. Tutor sessions, typed observations, and card proposals persist privately in Supabase and can be resumed on the current device. AI token usage and a 30-request daily account quota are implemented; their database migration and authenticated sync still need runtime validation and broader cross-device conflict validation. Desktop supports local study, encrypted sign-in, authenticated API access, and a main-process SQLite media store; signed packaging and device-level runtime validation remain. Web and mobile support local image/audio attachments, hash-verified media ZIP packages, and private workspace backups that preserve local review history, schedules, and media. Full-screen media editing and review states are captured in Storybook. Anki package interchange and sharing remain open.

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
