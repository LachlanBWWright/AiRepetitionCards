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

Account sync, hosted tutoring and cloud publishing require a configured Recall API. Desktop reads configuration from `apps/web` environment files: set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `RECALL_API_URL` only when enabling those features. Leave Supabase values blank for local-only use. Restart the desktop development process after changing configuration.

Published share links open in your default browser when clicked. Links must use the configured `RECALL_API_URL` origin and a valid shared-version path; arbitrary external navigation remains blocked. If opening fails, copy the link into your browser.

The trusted dashboard can copy share links to the clipboard. Clipboard reads and clipboard access from other frames remain blocked.
