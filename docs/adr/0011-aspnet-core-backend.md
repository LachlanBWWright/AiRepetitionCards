# ADR 0011: ASP.NET Core hosted backend transition

Status: accepted.

## Context

Next.js currently provides both the web application and hosted HTTP composition. A separate ASP.NET Core backend is desired for hosted operations and for a shared API used by web, Expo and Electron. The existing domain, application, Effect Schema contracts and platform adapters already define portable behavior; local study must continue to work without the hosted service.

## Decision

Move hosted HTTP and background operations from Next.js Route Handlers to an ASP.NET Core API, while retaining Next.js as the web frontend. Keep Supabase Auth, Postgres, Storage, existing SQL functions and row-level security as the initial identity and persistence services. This limits the transition to one major boundary at a time and preserves current data and authorization behavior. Do not introduce a second migration owner for the existing database.

The API is a composition boundary. Its domain and application layers remain framework- and provider-independent, use immutable data and typed expected failures, and validate external values before use. ASP.NET Core controllers/minimal endpoints, Supabase, AI and other provider integrations belong in API or infrastructure adapters. Vendor exceptions are classified at those adapters. The API does not own scheduling: clients continue to run deterministic scheduling locally and persist append-only review events.

Keep `/api/v1` paths, JSON shapes, error codes and identity semantics during migration. Effect Schema remains the canonical contract source under ADR 0007. Publish or generate JSON Schema/OpenAPI descriptions from those contracts where practical, and use shared fixtures to verify equivalent acceptance, rejection and identity validation in TypeScript and C#. Do not maintain an independent, drifting contract model.

The API verifies Supabase access tokens and enforces owner scoping. Browser session creation, refresh and sign-out move with the HTTP boundary; the browser continues to use secure first-party cookies and CSRF protection. Native clients continue to use bearer credentials. Service credentials remain server-only. ChatGPT website identity continues to map to the canonical Supabase identity as described by ADR 0008.

Migrate in feature slices, beginning with authentication and read-only workspace access, then workspace synchronization, then publishing/account operations and hosted tutoring/retention. Synchronization is the first write-heavy risk gate: preserve base-hash conflicts, causal/device ordering, idempotent review delivery, canonical timestamps and tombstones from ADR 0009. Test retries, concurrent devices and reviews associated with deleted cards before routing production writes to the new API.

Cut over each complete feature slice by routing its requests to ASP.NET Core. At any point there is one write owner for a given operation; do not dual-write or replay live mutations against both implementations. Keep the previous Next.js handlers deployable during staged rollout and retain a routing rollback to them until the new slice meets its runtime acceptance criteria. Rollback changes traffic only; it must not require reverting compatible database writes. Remove old handlers and server credentials after all slices, clients and operational jobs have moved and rollback is no longer needed.

## Consequences

Web, mobile and desktop share hosted operations while retaining their local stores and offline review workflows. The migration can proceed without replacing Supabase or redesigning persistence. Contract parity, browser/native authentication, authorization, multi-device sync, deployment health and rollback behavior require runtime acceptance; compilation and source checks alone do not establish them.

See [domain schemas and HTTP contracts](0007-domain-schemas-and-http-contracts.md), [identity and privacy](0008-identity-funding-prompt-trust-and-privacy.md), [sync and interoperability](0009-sync-sharing-and-interoperability.md), and [architecture](../architecture.md).
