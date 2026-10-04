# ADR 0008: Identity, AI funding, prompt trust and privacy

Status: accepted.

## Decision

Supabase Auth is the canonical hosted identity on every platform. Website ChatGPT OIDC maps verified issuer/client/subject to that identity and establishes Recall's first-party session. Email claims never automatically link accounts. An existing authenticated account can explicitly link ChatGPT with callback session revalidation.

Website session credentials remain in HttpOnly, SameSite=Lax cookies with Secure enabled in production. Browser account controls obtain only verified status and a display label from the server. Signing out clears the current application session; it preserves offline study data and does not revoke the user's OpenAI identity.

Hosted tutoring uses the server API key. Eligible open-source desktop distributions can separately enable local ChatGPT plan inference; dynamic client registration and protected rotating tokens stay in Electron main. Website identity grants do not fund hosted tutoring. Native mobile ChatGPT registration remains disabled until a documented flow exists.

Learning material and learner-authored AI instructions are untrusted data. The provider exposes no model database tools. Generated questions/evaluations/proposals pass shared schemas and objective checks. A learner must approve a proposal before it enters the durable card set; ordinary reviews invoke no model.

Private tutor transcripts and evidence can be erased independently of cards/reviews. Hosted inactive-session retention is configurable and applied by a protected bounded cleanup endpoint; deployment must schedule it. Local desktop history is profile-owned and remains until explicit clearing. Account erasure also cleans linked website identities. Export and deletion acknowledgements are validated before client cleanup. Operational logs omit identity, content, tokens and provider payloads.

## Consequences

Identity and inference credentials have different grants, storage and lifecycles. Account deletion and transcript deletion are distinct operations. Usage accounting, task routing and per-call budgets remain in application/provider boundaries, while downstream AI retention is governed by the provider.

See [ChatGPT setup](../sign-in-with-chatgpt.md), [tutor privacy](../tutor-privacy.md), [model routing](../task-model-routing.md), and [threat model](../threat-model.md). Issued credentials and live OAuth/inference acceptance remain deployment gates.
