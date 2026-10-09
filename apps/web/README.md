# Recall Web

The web app shell and navigation are available without an account. Reading, creating, or studying cards requires a signed-in Recall account and a reachable API. Study data is saved to the account service; the browser keeps only a temporary in-memory working copy and does not persist cards, reviews, or attachments in browser storage.

From the repository root, run `pnpm dev:api:next` to start the ASP.NET API, Next.js client, and local Supabase stack when needed. Web sign-in supports Apple and Google, with direct ChatGPT sign-in available when its SIWC configuration is enabled. Configure the OAuth provider credentials you use in Supabase. See the root [README](../../README.md#supabase-and-account-sign-in) for setup details.

Mobile and Electron are the clients for local-only study. They keep their workspace in SQLite and can be used without an account.
