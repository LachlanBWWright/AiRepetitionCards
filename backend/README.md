# ASP.NET Core backend

`Recall.Api` is the ASP.NET Core backend for Recall and targets .NET 10. It serves authentication, account operations, workspace and review sync, publishing, and hosted tutor workflows. Next.js remains the web frontend and provides a same-origin proxy for API and auth requests. Browser traffic can use ASP.NET by setting `RECALL_API_URL`; native and Electron clients can point their API origin at a host serving these routes once its production configuration is complete.

## Run locally

Install the .NET 10 SDK and confirm `dotnet --version` reports `10.x`. If the SDK is installed under `~/.dotnet` while an older system SDK takes precedence, put `~/.dotnet` first on `PATH` or run it directly as `~/.dotnet/dotnet`. From the repository root, start the API with:

```sh
dotnet run --project backend/Recall.Api --urls http://localhost:5000
```

To start the API together with a client, use `pnpm dev:api:next`, `pnpm dev:api:desktop`, or `pnpm dev:api:mobile` from the repository root. These launchers find a .NET 10 SDK, start the API, wait for `/health`, then start the selected client; Ctrl+C stops the processes they started. The Next.js launcher also starts local Supabase if credentials are absent and Docker is available. Launchers read optional server-only settings from the ignored root `.env.backend.local`. For a physical mobile device, set `EXPO_PUBLIC_RECALL_API_URL` to the host machine's LAN address; the mobile launcher binds ASP.NET to all interfaces by default. See the [root local-run instructions](../README.md#run-locally) for examples.

The checked-in launch profile binds `http://localhost:5000`, sets `Development`, and uses in-memory request limits. The health check is available at `http://localhost:5000/health` and works without credentials. Set `RECALL_API_URL=http://localhost:5000` in `apps/web/.env.local` (or the web app's environment) to have Next.js forward same-origin `/api/*` and `/auth/*` requests to this local API. No separate browser reverse proxy is needed for local development. ASP.NET reads configuration from standard .NET providers, including environment variables; it does not load `apps/web/.env.local` automatically. Configure the API's server-side values in its own shell or launch environment:

```sh
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_PUBLISHABLE_KEY="your-publishable-key"
export SUPABASE_JWT_AUDIENCE="authenticated"
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are accepted as fallbacks for the first two settings. For local Supabase, HTTP loopback URLs such as `http://127.0.0.1:54321` and `http://localhost:54321` work for workspace, account, and tutor operations. Do not put service-role, AI-provider, SIWC, Redis, or rate-limit secrets in browser-visible `NEXT_PUBLIC_*` variables. Configure those only in the API's server environment when enabling the corresponding features. Local rate limits default to in-memory storage; production requires the configured shared store and trusted proxy settings. `RECALL_TRUSTED_PROXY_IPS` is a comma-separated list of exact proxy peer IP addresses allowed to set `X-Forwarded-Host` and `X-Forwarded-Proto`; without it, ASP.NET trusts only loopback proxies. Configure the Next.js server's outbound peer address here when it is not loopback. The Supabase tables, policies, and RPCs used by the selected feature must also be present.

## Optional hosted features

Set only the server-side values for features you enable:

| Feature                                                                           | Configuration                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production rate limits                                                            | `API_RATE_LIMIT_MODE=redis`, `API_RATE_LIMIT_STORE_REST_URL`, and `API_RATE_LIMIT_STORE_REST_TOKEN` for an Upstash-compatible Redis REST endpoint. Set `API_RATE_LIMIT_TRUSTED_IP_HEADER` and `API_RATE_LIMIT_IP_HMAC_SECRET` (at least 32 characters) when using per-IP limits. The ingress must overwrite that header, and the API should only be reachable through trusted ingress. |
| Account deletion, tutor privacy and retention, immutable publication registration | `SUPABASE_SERVICE_ROLE_KEY`; keep it exclusively in the API environment. Publication creation uses the service-only atomic registration RPC; browser/mobile clients never receive this key.                                                                                                                                                                                            |
| Hosted tutor                                                                      | `OPENAI_API_KEY`; optionally select models with `OPENAI_MODEL`, `OPENAI_TUTOR_MODEL`, `OPENAI_EVALUATION_MODEL`, and `OPENAI_PROPOSAL_MODEL`. Optional shared daily limits use `AI_DAILY_TOKEN_BUDGET` and/or `AI_DAILY_REQUEST_LIMIT` with `AI_BUDGET_STORE_REST_URL`, `AI_BUDGET_STORE_REST_TOKEN`, and `AI_BUDGET_STORE_PREFIX`.                                                    |
| OpenAI website sign-in                                                            | `OPENAI_SIWC_CLIENT_ID`, `OPENAI_SIWC_REDIRECT_URI`, `OPENAI_SIWC_CLIENT_AUTH_METHOD`, and `OPENAI_SIWC_CLIENT_SECRET` when using `client_secret_basic`; durable transaction and identity storage also needs `SIWC_STORE_REST_URL`, `SIWC_STORE_REST_TOKEN`, and a 32-character-or-longer `SIWC_IDENTITY_KEY_SECRET`. `SUPABASE_SERVICE_ROLE_KEY` is also required.                    |
| Tutor transcript cleanup job                                                      | Configure `CRON_SECRET` for the GET job or `TUTOR_RETENTION_JOB_SECRET` for POST. `TUTOR_TRANSCRIPT_RETENTION_DAYS` defaults to 30; `TUTOR_RETENTION_BATCH_SIZE` defaults to 250.                                                                                                                                                                                                      |

Production also needs a shared API rate-limit store and a scheduler for transcript cleanup if those features are enabled. Local development deliberately defaults to in-memory rate limits. `RECALL_HTTP_LOGGING=true` enables sanitized request-failure logging; request IDs are always returned.

Useful endpoints include `GET /api/v1/auth/session`, `GET /api/v1/workspace`, and the route families listed in [the migration inventory](../docs/aspnet-migration-inventory.md). The SSR auth middleware reads and refreshes the Supabase server-side session cookie, while bearer authentication remains available to native and Electron clients. The Next.js proxy preserves the browser host and scheme. Set `RECALL_TRUSTED_PROXY_IPS` on the API when the proxy-to-API connection comes from an address other than loopback.

The solution is `Recall.sln`. See the [client cutover guide](../docs/aspnet-client-cutover.md), [migration inventory](../docs/aspnet-migration-inventory.md), [sync port checklist](../docs/aspnet-sync-port-checklist.md), and [contract bridge](../docs/dotnet-contract-bridge.md). Shared response examples are under [`../contracts/fixtures/dotnet-v1/`](../contracts/fixtures/dotnet-v1/).

With the checked-in `Recall.Api` launch profile, Swagger UI is available at `http://localhost:5000/swagger` and the generated OpenAPI JSON at `http://localhost:5000/swagger/v1/swagger.json`. Both are enabled only in the Development environment; production does not expose the interactive API explorer. The OpenAPI document describes all mapped operations, known response statuses and media types, common error envelopes, supported query/header inputs, and bearer or SSR-cookie authentication. `python3 backend/scripts/verify-openapi.py` checks these documented guarantees against the live Development document. Many polymorphic JSON payloads intentionally remain open-object schemas: the runtime TypeScript validators and [contract bridge](../docs/dotnet-contract-bridge.md) remain authoritative until those schemas are generated from shared contracts and cross-language fixtures cover the full payload set.

## Shared deck storage

The initial schema is split into six ordered SQL migrations, starting with `supabase/migrations/20261003000000_initial.sql`. Together they include publication, learning activities, sharing, updates, moderation, and storage policies. Initialize a fresh local database with `pnpm exec supabase migration up --local`, or apply all six migrations in filename order when provisioning the first deployment. Local databases that already applied the former consolidated schema must reconcile their migration history before applying the split chain; those later files contain statements already present in that schema. There is no incremental upgrade history because the app has not been deployed. Sharing supports public publication and unlisted exact-version links; it has no named viewer grants. User operations use the caller's bearer JWT, so `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or their documented public fallbacks) must be set. `SUPABASE_SERVICE_ROLE_KEY` is also required server-side for immutable publication registration and operator actions; it must never be sent to a client. Set server-only `RECALL_MODERATOR_USER_IDS` to a comma-separated list of operator UUIDs to enable the moderation API. The local verification suite exercises publication and row-level policies against an explicitly configured loopback Supabase instance; pure checks alone do not establish deployment migration state.

To exercise the running ASP.NET routes as an owner and learner, start the API with the local Supabase URL, publishable key, and server-only service-role key configured. Then set `RECALL_INTEGRATION_SUPABASE_URL`, `RECALL_INTEGRATION_SUPABASE_PUBLISHABLE_KEY`, `RECALL_INTEGRATION_SUPABASE_SERVICE_ROLE_KEY`, and `RECALL_INTEGRATION_API_URL` to the local Supabase and API origins and run:

```sh
python3 backend/scripts/verify-deck-sharing.py
```

The verifier accepts only loopback HTTP(S) origins, creates run-scoped Auth users and workspace areas, and removes their deck rows, publications, account data, and Auth identities in cleanup. It checks authoring, publication, retired access routes, public and unlisted links, fork lineage, the updates inbox and read marker, feedback, idempotent reports, publisher blocks, operator access denial for an ordinary user, withdrawal, and retained owner history through the real API. Set `RECALL_INTEGRATION_MODERATOR_ACCESS_TOKEN` to an already allowlisted operator's access token to also verify the operator queue, report resolution, deck hide/restore, republishing without clearing the hide, and protected audit table. Without it, the verifier explicitly skips those successful operator-route checks. It does not start, migrate, or reset Supabase and never prints keys or bearer tokens.

## Learning activities

The ASP.NET API serves `GET/POST /api/v1/activities`, `POST /api/v1/activities/assess`, and `POST /api/v1/activities/question`. Requests are authenticated against the caller's canonical workspace and activity/attempt IDs. Library payloads are bounded and validated before service-role compare-and-swap writes; direct authenticated writes to the backing RPC are disabled. Assessment and question results remain proposals until the learner accepts them. Hosted assessment uses the existing tutor provider and budget controls. Coding activity runs use the preconfigured `recall-code-runner:1` container; the API does not build an image or run learner code in the API process. See the root [README](../README.md#offline-use-and-optional-services) for client and activity behavior.

## Automated contract verification

The `Backend contracts` workflow builds `Recall.sln`, checks generated JSON Schemas against
Effect definitions, validates shared positive and negative fixtures in TypeScript and .NET,
and starts a Development API for `verify-openapi.py`. Run the C# fixture checks locally with
`dotnet run --project backend/Recall.ContractChecks -- .` from the repository root.
After a Release build, `python3 backend/scripts/verify-api.py` starts a temporary Development API,
checks its OpenAPI document, and stops it. Add `--publishing` with the explicit local integration
credentials above to also exercise publishing routes. Use `--port` to override its default 5019.
See [the contract bridge](../docs/dotnet-contract-bridge.md) for generation and parity commands.
The Supabase integration workflow also runs automatically for relevant pull requests and
main-branch changes, using disposable local services and the real publishing HTTP verifier.
