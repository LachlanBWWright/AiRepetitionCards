# Desktop application

Electron runs the shared learning dashboard with local SQLite, attachment storage, file dialogs and protected account credentials.

## Run locally

From the repository root:

```bash
pnpm install
pnpm dev:desktop
```

The desktop app uses the native window frame and window controls. Linux and Windows omit the File/Edit/View/Window menu bar; macOS keeps its system application menu.

Saved-data errors appear as toasts with a reload action; failed reads never clear the database. Desktop navigation hashes retain access to the same trusted local renderer document.

No credentials, Supabase setup or running web server are required. Electron starts its own renderer and saves cards, reviews and attachments locally. Authoring, offline study, imports/exports and private backups work without signing in.

## Optional cloud features

Account sync, hosted tutoring and cloud publishing require a configured Recall API. To run both services locally, use `pnpm dev:api:desktop` from the repository root. Desktop reads `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `RECALL_API_URL` from `apps/web` environment files; the combined launcher starts ASP.NET at `http://localhost:5000` and sets that API origin for Electron. Backend-only settings can go in the ignored root `.env.backend.local`; ASP.NET does not load the web `.env` file itself. Desktop stores its Supabase sign-in in encrypted OS storage and sends bearer tokens from the Electron main process. Leave Supabase values blank for local-only use. Restart the desktop development process after changing configuration. For release builds, set `RECALL_API_URL` to the reachable HTTPS API origin or gateway.

Published share links open in your default browser when clicked. Links must use the configured `RECALL_API_URL` origin and a valid shared-version path; arbitrary external navigation remains blocked. If opening fails, copy the link into your browser.

The trusted dashboard can copy share links to the clipboard. Clipboard reads and clipboard access from other frames remain blocked.

## ChatGPT usage

Recall connects one ChatGPT account at a time. Sign out before connecting another account.
Older stores retain only the current connection (or the first saved registration when none
was active). Removing legacy local connections does not revoke their remote grants; manage
those in ChatGPT settings. Recall study data and token history are preserved.

**View usage and limits in ChatGPT** opens ChatGPT's usage settings in the system browser,
where users can review their allowance and app limits. Recall does not display raw token
counters or estimated subscription costs. There are no Recall request-count caps on
ChatGPT access; legacy caps are ignored. No Recall account or server is needed.

The main-process ledger in `userData/chatgpt-local/usage.json` records account identifiers,
task/model names, timestamps, outcomes and reported token counts, without prompts, responses
or credentials. `chatgpt.usage(clientId)` exposes validated activity for the current connection.
Invalid or unavailable storage stops inference instead of silently clearing history.

## ChatGPT tutoring and web research

Connect ChatGPT from **Account settings** or the **AI settings** button in Tutor without a Recall account. Connection, model, sign-out and usage controls stay inside the settings modal. The settings entry works with an empty library and without Supabase configuration. Recall sign-in is optional for sync; signing out of Recall preserves ChatGPT access. Disconnect ChatGPT separately in its connection controls. ChatGPT is the desktop AI provider and is used automatically when connected, including after restarting the app. There is no provider toggle or fallback to hosted Recall AI. Model selection is shared between settings and Tutor for the running app.

Direct ChatGPT-plan access is enabled in desktop development and packaged builds by default. No build flag is required. In Tutor, authorize plan use, select an available model, then open **Materials → Research the web** for a cited web-search answer. This uses OpenAI directly and needs neither a Recall server nor an API key. OpenAI may restrict search for particular models, accounts or workspaces. Search failure preserves existing results and never changes the billing source. Cards and quiz material remain unchanged until you explicitly author or import content.

Research links open in the system browser through a main-process allow-list of citations returned by the completed search. The application renderer remains locked against arbitrary external navigation. Credentials stay in the main process; only your research query is submitted, rather than the whole deck. See [ChatGPT setup](../../docs/sign-in-with-chatgpt.md).

The model picker lists models available to the selected ChatGPT account in an app-themed menu with keyboard navigation and includes an explicit reload action. Its current selection applies to tutoring and research; separate per-task choices and saved model preferences are not implemented. **Manage usage** opens ChatGPT's Usage settings in the system browser, where users review app usage and limits. The app pauses requests on a provider usage-limit response and offers an explicit retry after checking settings; it does not infer remaining allowance or a reset time.

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

Each artifact includes `checksums.json` and is retained for 14 days. CI verifies every expected installer format and architecture before upload. The packages run offline without repository secrets. Optional repository variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `RECALL_API_URL` (or `NEXT_PUBLIC_RECALL_API_URL`) configure server features in the same packages. Direct ChatGPT authorization is included in all desktop package workflows, including pull-request and push builds. Signing, notarization, and store publication remain separate release steps.

Desktop credential storage initializes Electron's async encryptor before checking the Linux backend. Terminal launches without desktop environment hints select the OS Secret Service provider before app readiness; explicit password-store overrides and detected desktop sessions are preserved. Plaintext backends remain unsupported. Connecting ChatGPT selects it as the AI source; no Recall login is required.

GPT-6 Luna (`gpt-6-luna`) is the default when the connected account offers it.
An explicit model choice is preserved; accounts without Luna use their first available model.

Tutor and Improve wait for the ChatGPT account and model selection before sending messages.
If no model is selected, choose one in Account → AI settings; your draft is retained.
Local request validation failures are distinguished from OpenAI rejections.

Tutor requests send application instructions separately from study content and request JSON output, which is validated before changing the notebook. Completed response text is authoritative. Refusals, incomplete responses, request-format errors, timeouts and transport failures have distinct messages; errors never include provider bodies or credentials.

ChatGPT inference explicitly requests event-stream responses and validates event frames and completion instead of rejecting responses solely by their content-type header. Gateway JSON error envelopes are classified as provider failures.

Desktop development watches both the Electron main process and preload code (`electron-vite dev --watch`), rebuilding and restarting them when changed so request-handler fixes reach the running app.

Live inference verification found a provider response with no MIME header and an empty terminal `output` array despite completed output-item events. Recall preserves those completed items, including text and citations, and still requires the final completion event. Both a live JSON request and the local Tutor question workflow passed through the running main-process handler after this correction.

ChatGPT connection status is rechecked after loading models, since token refresh can expire
the session. Expired sessions show **Reconnect ChatGPT** and **Remove ChatGPT connection**;
**Ready** requires a usable model. Signing out cancels model loading and clears local
credentials before attempting remote revocation, with a five-second total revocation limit.
If revocation is unconfirmed, the app remains signed out and shows how to revoke access remotely.
