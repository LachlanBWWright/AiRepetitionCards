# Deployment and operations runbook

This runbook covers the current hosted web stack: Next.js Route Handlers, Supabase Auth/Postgres/Storage, and optional server-side OpenAI tutoring. Mobile and desktop use the same hosted API; their store signing and release steps are platform-specific and remain separate work.

## Environments and secrets

Use separate Supabase projects, OpenAI credentials, and deployment environments for local development, staging, and production. Never reuse a production service-role key in local development or preview deployments.

Configure these values in the web deployment's server environment:

For a deployment with multiple instances, set `API_RATE_LIMIT_MODE=redis`, `API_RATE_LIMIT_STORE_REST_URL`, `API_RATE_LIMIT_STORE_REST_TOKEN` and a unique `API_RATE_LIMIT_STORE_PREFIX`. Production defaults to Redis and returns 503 if required storage configuration is missing. The local `.env.example` explicitly selects memory; change it for distributed deployments. To enable IP limits, configure a proxy that overwrites a single-address header and blocks direct origin access, then set `API_RATE_LIMIT_TRUSTED_IP_HEADER` and a shared random `API_RATE_LIMIT_IP_HMAC_SECRET` of at least 32 characters. See [HTTP operations](http-operations.md) for protocol, timeout, privacy and trust requirements. Redis and proxy enforcement need deployment acceptance before release.

| Variable                               | Required             | Notes                                                                                |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes                  | Supabase project URL.                                                                |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes                  | Publishable client key; database RLS remains mandatory.                              |
| `RECALL_API_URL`                       | Desktop clients      | Public origin of the matching web API.                                               |
| `SUPABASE_SERVICE_ROLE_KEY`            | For account deletion | Server-only; never prefix with `NEXT_PUBLIC_`. Deletion is unavailable when missing. |
| `OPENAI_API_KEY`                       | Optional             | Server-only; omit to disable AI.                                                     |
| `OPENAI_MODEL`                         | Optional             | Model name used by the server adapter.                                               |

Optional [hosted AI budgets](task-model-routing.md#daily-hosted-budgets) require `AI_DAILY_TOKEN_BUDGET` and/or `AI_DAILY_REQUEST_LIMIT`, plus server-only `AI_BUDGET_STORE_REST_URL` and `AI_BUDGET_STORE_REST_TOKEN`. Use an environment-specific prefix and Redis with atomic scripting, protected against eviction and data loss. Configured storage failures stop inference; unset limits preserve the existing Supabase call quota.

Store secrets in the hosting provider's encrypted secret manager. Do not commit `.env.local`, print secrets in CI, or include them in desktop/mobile bundles. After rotation, redeploy and verify the feature that consumes the secret.

## Staging deployment

1. Create a fresh Supabase project and configure Auth email delivery. Set the production-style Site URL and allow-list the staging web `/auth/confirm` URL plus `recall://auth/confirm` for native email-link sign-in. Configure the Magic Link template to use `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`.
2. Apply every committed migration in timestamp order using the Supabase CLI linked to the staging project. Review the target project before applying. Generate database types from the applied schema with `pnpm supabase:types` and commit/regenerate them when migrations change.
3. Set the deployment environment variables above. Add `SUPABASE_SERVICE_ROLE_KEY` only to the server environment. Configure SMTP before testing delivered sign-in messages; local Supabase uses an inbox capture service instead.
4. Deploy the web app and confirm sign-in, sign-out, authenticated sync, content conflict handling, tutor (if enabled), account export/deletion, publication, and media read/write flows. Verify public and unlisted visibility separately, including revoked-link behavior.
5. Run the repository quality gates in CI (`pnpm policy`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm build-storybook`). These do not prove runtime PostgreSQL/RLS correctness; staging must include database-level integration checks before production approval.
6. Point a staging Electron/mobile build at the staging API and verify email-link return, bearer auth, sync, media, and deletion on supported devices. Do not treat web builds or Storybook as device validation.

## Production release gates

Before production, require a reviewed migration plan, validated RLS and storage policies against a running database, a tested backup restore, a deletion/retention procedure, operational alerting, and a rollback/redeploy owner. Confirm the service-role key is server-only and that production secrets are isolated from previews. Configure database backup retention and perform a restore drill: backup scheduling and restore automation are not defined in this repository. Set provider-side spend limits/alerts for OpenAI; the app retains its 30-request daily tutor quota per account, supports optional durable hosted admission budgets, and supports shared Redis API throttles. Configure the Redis REST adapter for production; live Redis/proxy acceptance and external usage alerts remain deployment gates.

Deploy the web app and migrations as a coordinated change. Take/confirm a provider backup before schema changes, apply migrations, deploy the matching app version, then verify health and critical flows. Avoid destructive local or project reset commands against hosted projects. If the migration or app fails, stop further deployment, follow the reviewed database rollback/forward-fix plan, and keep the prior compatible app available where possible.

## Account deletion and sharing operations

- Account deletion requires typed `DELETE` confirmation and the service-role secret. The server erases owner data through `erase_account_data` before deleting the Auth identity, then signs out the requesting session. A failure after data erasure but before Auth deletion can leave an identity with erased application data; inspect the account and retry through a controlled operator process. Validate this flow on staging before enabling it in production.
- Public publication content is intentionally world-readable. Unlisted publication links are bearer credentials; rotate/revoke from the owner flow if disclosed. Revocation prevents future API access but cannot remove copies already downloaded.
- Published media lives in the private `published-media` bucket and is served only when a published snapshot references it and the visibility/token check passes. Abandoned uploads may become orphans; no cleanup job is currently configured.

## Monitoring and incident notes

Monitor hosting and Supabase availability, auth failures, database/storage errors, OpenAI errors and usage, and account deletion failures. Keep logs privacy-safe: record request identifiers, status, timing, and error classes, not auth tokens, share tokens, tutor transcripts, or raw imported content. Set `RECALL_HTTP_LOGGING=true` for sanitized per-request operation events and generated request IDs; configure external collection, retention and alerts in the hosting stack. See [HTTP operations](http-operations.md) for shared Redis limits and trusted-proxy configuration. With the Vercel project root set to `apps/web`, `vercel.json` schedules the authenticated [tutor retention endpoint](tutor-privacy.md) daily at 03:00 UTC. Set a separate `CRON_SECRET` (32–4096 printable non-whitespace ASCII characters), the server-side Supabase service-role key and retention policy before deploying; `TUTOR_RETENTION_JOB_SECRET` authorizes manual POST cleanup. Live scheduler execution remains unverified.

For credential exposure, rotate the key and redeploy. For an unlisted-link leak, revoke/rotate the link. For suspected data exposure or loss, preserve logs, limit affected credentials/routes, assess affected data, and follow the organization's incident and notification procedures. Restore from a verified provider backup only after assessing the incident and preserving necessary evidence.

## Local runtime

Use `pnpm supabase:start` and copy the local URL/publishable key into `apps/web/.env.local`. Local mail is captured by Supabase's inbox service. `pnpm supabase:reset` is destructive to the local database. Generated database types are checked into `packages/infra-supabase/src/database.types.ts`. Historical setup notes do not prove current database state or isolation; live migration, RLS and Storage acceptance remains unverified in this audit. See [the root README](../README.md) for app startup and environment details.

## Web content security policy

Web pages render dynamically with a fresh script nonce forwarded through the proxy and Supabase cookie refresh. Do not cache nonce-bearing HTML across requests at the CDN. The policy restricts connections to this origin and the validated configured Supabase origin, denies embedded frames/objects, and permits local blob/data media. Existing inline CSS and WebAssembly compilation remain allowed for the UI and bounded Anki importer; JavaScript evaluation is allowed only during development. Browser enforcement and authentication/import flows still need runtime acceptance. There is no blanket insecure-request upgrade, preserving configured HTTP loopback development.
