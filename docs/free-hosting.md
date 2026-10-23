# Free hosting

Recall uses a Vercel Next.js project, a separate Render Docker service, Supabase
Auth/Postgres/Storage, and an Upstash Redis database. Select the free plans and
disable automatic Upstash plan upgrades. Render's free running hours are shared
with other services in the workspace; idle services sleep and the first request
can take about a minute. Supabase free projects can pause after inactivity.

## Configuration

Set the Vercel project root to `apps/web`, use Node 22, and install the frozen
pnpm workspace. Connect the Supabase integration to production only. Connect
Upstash to production only; preview builds must not receive production secrets.

The Render service uses `backend/Dockerfile` with `backend` as its build context.
Validate the configuration with `render blueprints validate render.yaml`.
`/health` checks process liveness; deployment acceptance must also verify real
authenticated database and Redis operations. Automatic deployment starts disabled.

Configure these server-only values:

- Vercel: `RECALL_API_URL` (the Render HTTPS origin), `RECALL_PROXY_SECRET`,
  `RECALL_OAUTH_PROVIDERS=none`, and a random `CRON_SECRET`.
- Render: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `RECALL_WEB_ORIGIN`, `RECALL_PROXY_SECRET`,
  `API_RATE_LIMIT_MODE=redis`, `API_RATE_LIMIT_STORE_REST_URL`,
  `API_RATE_LIMIT_STORE_REST_TOKEN`, and the same `CRON_SECRET`.

The proxy secret must be the same random 32–256 character value on both servers.
The API accepts the configured public HTTPS web origin only when that shared
secret authenticates the proxy. Native bearer requests remain independent.
Never put this secret or service-role/Redis credentials in public variables.
Vercel uses an external rewrite for backend traffic so API bodies are forwarded
by the hosting proxy instead of being returned from a second function.

Leave `OPENAI_API_KEY` and website ChatGPT client settings unset to disable hosted
AI and ChatGPT website sign-in. Email-link sign-in remains available. Add OAuth
providers only after configuring their clients and callback URLs.

Set Supabase's Site URL to the production Vercel origin and allow its exact
`/auth/confirm` callback plus `recall://auth/confirm`. Keep the hosted email
template's default confirmation URL for the browser PKCE callback. Supabase's default
email sender has recipient and rate restrictions; broader use requires custom
SMTP. Never claim that sending a real email was tested from a generated admin link.

## Release sequence

1. Pass clean type generation, types, lint, formatting, tests, web/Storybook builds,
   and the .NET Release build. Build and smoke-test the Docker image.
2. Confirm the linked Supabase project ID, review `supabase db push --dry-run`,
   and apply the complete chain to Recall's project. Keep other apps isolated.
3. Deploy the reviewed backend commit and verify Redis and database isolation.
4. Deploy the matching Vercel source, then test cookies, sign-out, review sync,
   media, large content transfers, and account isolation through the public URL.
5. Promote only the validated version. Record the two deployment IDs for rollback;
   rolling back code does not roll back database migrations.

Android development APKs are available through the existing GitHub Actions
artifacts. They use debug signing; replacement builds can require uninstalling
the previous app. Export local data first. No store submission or dedicated
release signing is configured by this free-hosting setup.
