# Desktop application

Electron runs the shared learning dashboard with local SQLite, attachment storage, file dialogs and protected account credentials.

## Run locally

From the repository root:

```bash
pnpm install
pnpm dev:desktop
```

No credentials, Supabase setup or running web server are required. Electron starts its own renderer and saves cards, reviews and attachments locally. Authoring, offline study, imports/exports and private backups work without signing in.

## Optional cloud features

Account sync, hosted tutoring and cloud publishing require a configured Recall API. To run both services locally, use `pnpm dev:api:desktop` from the repository root. Desktop reads `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `RECALL_API_URL` from `apps/web` environment files; the combined launcher starts ASP.NET at `http://localhost:5000` and sets that API origin for Electron. Backend-only settings can go in the ignored root `.env.backend.local`; ASP.NET does not load the web `.env` file itself. Desktop stores its Supabase sign-in in encrypted OS storage and sends bearer tokens from the Electron main process. Leave Supabase values blank for local-only use. Restart the desktop development process after changing configuration. For release builds, set `RECALL_API_URL` to the reachable HTTPS API origin or gateway.

Published share links open in your default browser when clicked. Links must use the configured `RECALL_API_URL` origin and a valid shared-version path; arbitrary external navigation remains blocked. If opening fails, copy the link into your browser.

The trusted dashboard can copy share links to the clipboard. Clipboard reads and clipboard access from other frames remain blocked.

## Local budgets and usage framework

The shared application package provides validated local request policies, admission,
settlement and usage summaries. Desktop ChatGPT tutoring and research reserve a
request in `userData/chatgpt-local/usage.json` before sending it to OpenAI and record
its outcome afterward. The ledger contains account identifiers, task/model names,
timestamps and reported token counts; it contains no prompts, responses or credentials.

Policies support `dailyRequestLimit`, `weeklyRequestLimit` and `dailyResearchLimit`.
`null` means unlimited and `0` disables the corresponding requests. Days use UTC;
weeks start Monday at 00:00 UTC. Every admitted request counts, including failed
requests and reservations left pending after a shutdown. Missing provider token
counts remain unknown. File validation or persistence failures stop requests rather
than silently clearing history or bypassing a budget.

The preload exposes `chatgpt.usage(clientId)` and `chatgpt.setBudget(policy)` for the
active account. The Effect-based `localChatGPTUsageApi` in the web renderer validates
their replies. This is framework support; a budget settings screen is not included.
Policies default to unlimited. Limits apply to this installation's request admissions,
not token consumption, monetary spend, other devices or remaining ChatGPT allowance.
ChatGPT's own limits remain available through **Manage usage**. No Recall server is needed.

## ChatGPT tutoring and web research

Eligible distributions can enable direct ChatGPT-plan access with `RECALL_CHATGPT_LOCAL_ENABLED=true` when building. In Tutor, authorize plan use, select your ChatGPT account and an available model, then use **Research a topic** for a cited web-search answer. This uses OpenAI directly and needs neither a Recall server nor an API key. OpenAI may restrict search for particular models, accounts or workspaces. Search failure preserves existing results and never changes the billing source. Cards and quiz material remain unchanged until you explicitly author or import content.

Research links open in the system browser through a main-process allow-list of citations returned by the completed search. The application renderer remains locked against arbitrary external navigation. Credentials stay in the main process; only your research query is submitted, rather than the whole deck. See [ChatGPT setup](../../docs/sign-in-with-chatgpt.md).

The model picker lists models available to the selected ChatGPT account and includes an explicit reload action. Its current selection applies to tutoring and research; separate per-task choices and saved model preferences are not implemented. **Manage usage** opens ChatGPT's Usage settings in the system browser, where users review app usage and limits. The app pauses requests on a provider usage-limit response and offers an explicit retry after checking settings; it does not infer remaining allowance or a reset time.

## Local Linux package

`pnpm package:desktop` creates an unpacked application at `apps/desktop/release/linux-unpacked/desktop` on Linux. `pnpm --filter desktop dist:linux` creates a portable AppImage under `apps/desktop/release/`. Run `node scripts/write-desktop-checksums.mjs` to record installer hashes. These local packages need no cloud credentials; they are unsigned development artifacts.

## Continuous integration packages

Every push to `main`, pull request, and manual run of **Desktop packages (unsigned development)** builds these downloadable GitHub Actions artifacts:

| Artifact                      | Contents                        |
| ----------------------------- | ------------------------------- |
| `recall-unsigned-linux-x64`   | AppImage                        |
| `recall-unsigned-windows-x64` | NSIS installer (`.exe`)         |
| `recall-unsigned-macos-x64`   | Intel Mac `.dmg` and `.zip`     |
| `recall-unsigned-macos-arm64` | Apple Silicon `.dmg` and `.zip` |

Each artifact includes `checksums.json` and is retained for 14 days. CI verifies every expected installer format and architecture before upload. The packages run offline without repository secrets. Optional repository variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `RECALL_API_URL` (or `NEXT_PUBLIC_RECALL_API_URL`) configure server features in the same packages. Direct ChatGPT authorization is enabled only by the manual `chatgpt_direct` input for an eligible distribution. Signing, notarization, and store publication remain separate release steps.
