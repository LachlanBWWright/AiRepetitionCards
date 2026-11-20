# Managed AI

Managed AI is an alternative to the learner’s ChatGPT connection. Recall supplies provider credentials and grants an account a bounded allowance. Ordinary offline study still needs neither AI nor an account. The initial implementation uses administrator grants; it does not include subscription checkout, automatic credits, anonymous inference or arbitrary agent tools.

The path is implemented for the ASP.NET API and the Next.js rollback API, with explicit selection on web, Electron and native. It is disabled by default and has not been activated against paid provider accounts. Do not enable production access until configured model capabilities, current prices, deployment identity/RLS and real-device flows have been verified.

## Behavior

In Account → AI settings, choose **My ChatGPT connection** or **Recall managed AI**. Native calls the former **ChatGPT plan**. The selection is saved per Recall account, using browser local storage/Electron renderer storage or native SecureStore. Switching accounts starts with that account’s preference, without inheriting the previous account’s managed grant. BYO remains the default. Provider errors never change funding.

The private `/api/v1/ai/capabilities` endpoint requires verified Recall identity and returns only account-owned availability and daily allowance summaries. The server rechecks grants during admission; a cached UI summary cannot authorize spending. Managed requests include an explicit funding header and a request UUID, which Electron forwards through validated IPC. Repeated admitted UUIDs are rejected rather than generating again. Funding/account changes isolate conversation scopes and invalidate visible proposals. Native managed conversations and notebook drafts use account-specific namespaces; older unscoped hosted session pointers are not automatically imported.

Managed routing covers all eight structured tutor operations and the adaptive activity question/evaluation paths. Research remains on the local BYO path: managed adapters expose neither web search nor tool execution. This is an intentional platform capability limit, not an automatic switch back to BYO. Future tool-using agents need tool authorization, step limits, whole-run budgets and explicit approval of side effects.

## Providers and validation

Deployments select either `openai` or `anthropic`, a model, an immutable pricing version and request limits. Routes select a deployment per operation; clients cannot supply a provider URL, model or credential. Credentials stay on the API server. There is no post-dispatch failover and no retry of an ambiguous generation.

OpenAI uses Responses with `store:false`; Anthropic uses Messages with `output_config.format`. Both use non-streamed structured JSON, bounded output and a 45-second provider timeout. Anthropic schemas are projected onto its supported subset, retaining unsupported constraints in descriptions; the original schemas and application checks still reject invalid output. Source/objective validation and user approval remain required before generated cards are saved. The infrastructure package’s historical `infra-openai` name remains stable; the Anthropic transport is a separate protocol implementation, not an OpenAI-compatible endpoint assumption.

Protocol references: [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) and [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Operator-selected models must support these protocols in the configured account and region. No model or tariff is inferred from a vendor name.

## Authoritative accounting

Migration `20261105000000_managed_ai.sql` adds operator-owned policy, deployment, route and grant tables plus a provider-aware call ledger. RLS and explicit privileges prevent ordinary clients from changing grants, reserving provider spending or settling their own usage. Only the service-role server can call these RPCs, after verifying the user’s identity. Do not expose the service-role key.

Admission serializes against the platform policy, rechecks the grant and deployment, and atomically reserves both per-account and platform UTC-day budgets. It enforces grant expiry, deployment allowlists, request counts and account concurrency. Each ledger row records owner, operation, provider, deployment, configured model, returned model when reported, pricing version/rates, request identity, original day, reservation and actual usage. Financial metadata contains no prompts, transcripts or provider payloads.

Money is represented as integer micro-US dollars. Tariffs are micro-US dollars **per million tokens**. For example, a tariff of `1000000` represents $1 per million tokens; this is a units example, not a suggested vendor price. Use conservative, current tariffs that cover every applicable input/cache charge and output/reasoning charge. Explicit prompt caching, service-tier premiums and provider tools are not enabled by these adapters.

The hold uses the complete serialized request’s byte count plus 1,024 conservative protocol units and the enforced output ceiling. Both API implementations measure the exact serialized provider payload, including its full prompt and projected schema. These are admission bounds, not exact tokenizer or invoice estimates. Known token usage settles once against the original admission day at the recorded rates; identical settlements are idempotent, conflicting ones fail. Rejected/malformed output is still charged when usage is known. Missing usage, transport errors and cancellation retain the full hold; unknown usage is never a zero-cost refund. Actual charges exceeding the hold disable the database kill switch for operator reconciliation.

Concurrency leases last two minutes, longer than the provider timeout, so crashed requests cannot block an account forever. Lease expiry releases concurrency only, not money. Unknown calls may be reconciled through `managed_ai_settle` with provider-verified counts and returned model; never refund from a client report. The ledger has no automatic financial-record purge. Account erasure cascades owned call metadata; platform daily totals remain conservative. Existing hosted daily call limits and optional Redis budgets remain additional limits; they do not replace managed admission.

## Setup and rollout

1. Apply the migration through the existing Supabase deployment workflow. It creates no active deployments or grants and inserts a disabled database policy. This implementation did not modify an existing developer or production database.
2. Configure server-only `SUPABASE_SERVICE_ROLE_KEY`, the existing Supabase origin, and `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`. Set `MANAGED_AI_ENABLED=true` on the chosen API owner. The Next.js proxy does not need provider credentials when ASP.NET owns API traffic. Keep one API owner at a time.
3. Insert deployment rows and operation routes with current models, a pricing version and conservative rates. Never edit a pricing version in place to change its meaning; use a new version. Invalidate/recheck any prepared request if its deployment/model/version changes before reservation. Only the two installed provider IDs are accepted.
4. Grant eligible accounts an expiry, deployment allowlist, daily monetary/request limits and concurrency limit. A missing/expired/revoked grant fails closed. No client or external email claim can mint a grant. Set a conservative platform daily budget and enable `managed_ai_policy.enabled` last.
5. Verify real-provider output/usage and cancellation with test accounts before expanding grants. Check capabilities, denied access, all tutor operations, adaptive activities, account switching, quota exhaustion and UI recovery on all three platforms. Then expand grants to the intended user population. Anonymous accounts remain ineligible.

Example operator transaction (replace all placeholders before execution; no secret values belong in SQL):

```sql
begin;
insert into managed_ai_deployments
  (id,provider_id,model,enabled,pricing_version,input_microusd_per_million,output_microusd_per_million)
values ('primary','openai','YOUR_VERIFIED_MODEL',true,'YOUR_PRICING_VERSION',YOUR_INPUT_RATE,YOUR_OUTPUT_RATE);
insert into managed_ai_routes(operation,deployment_id)
select operation,'primary' from unnest(array['question','evaluate','propose-card','targeted-quiz','study-card','refine-card','inspect-card','plan-study']) operation;
insert into managed_ai_grants(user_id,expires_at,enabled,deployment_ids,daily_budget_microusd,daily_request_limit,concurrent_limit)
values ('YOUR_ACCOUNT_UUID',now()+interval '30 days',true,array['primary'],YOUR_DAILY_ALLOWANCE,30,1);
-- Enable only after checking deployments, current tariffs and server credentials.
update managed_ai_policy set enabled=true,daily_budget_microusd=YOUR_PLATFORM_DAILY_LIMIT where id;
commit;
```

For Anthropic, use a separate deployment and `provider_id='anthropic'`; route selected operations to it. Legacy hosted requests without the managed header retain their existing configuration path when managed mode is disabled. When managed mode is enabled, missing funding selection is rejected, so legacy clients cannot bypass the new ledger. New clients always require explicit managed selection for hosted generation.

Disable further managed admission immediately by setting `managed_ai_policy.enabled=false` (global), disabling a deployment, or revoking a grant (account). The server flag is a separate rollout gate. These switches do not claim to cancel generations already dispatched. Review `pending` calls past their lease and `unknown` calls before making refunds; retain holds when vendor usage cannot be established. Monitor provider/deployment failure rates and ledger anomalies using metadata only.

## Review findings addressed and remaining gates

The original review identified divergent funding controls, hard-coded OpenAI composition, optional budgets without entitlements, implicit provider identity, duplicate API implementations, unsafe failover possibilities and unguarded secondary AI paths. Shared funding policy, service-role admission, two protocol adapters, generated capabilities contracts and account-isolated selection address those implementation gaps. Application-only routing remains portable; the database catalog is authoritative for managed server deployments.

Deployment acceptance still requires actual migration/RLS verification, issued provider credentials, real model/schema/usage conformance, and rebuilt native/Electron device checks. Automated tests use fixtures and an isolated Postgres database; they do not prove paid inference or commercial subscription behavior. Paid checkout, automated grant provisioning, provider invoice reconciliation and managed research/tool execution are separate future features.

## Verification

- `pnpm test ai-funding-store.test.ts managed-ai-routing.test.ts tutor-provider-openai.test.ts dotnet-contract-parity.test.ts`
- `pnpm test:local-integration managed-provider.test.ts managed-auth.test.ts`
- `pnpm test:managed-ai-ledger` (Docker; isolated Postgres container, rollback fixtures and eight simultaneous admission attempts; always removes its container)
- `dotnet run --project backend/Recall.ContractChecks -- .` (shared contracts and both provider protocols)
- Storybook browser checks in `apps/web/tests/e2e/managed-ai.test.mjs` and `chatgpt-startup.test.mjs`

The capabilities schema is exported through `pnpm contracts:generate` and checked against shared TypeScript/C# fixtures. Setup still follows [the API cutover guide](aspnet-client-cutover.md) and [backend README](../backend/README.md).
