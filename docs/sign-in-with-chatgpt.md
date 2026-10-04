# Sign in with ChatGPT

Recall supports two separately configured integrations from OpenAI's documentation:

- **Website identity:** a registered OAuth client signs users in to Recall or explicitly links ChatGPT to their existing Recall account. This creates Recall's usual Supabase session. Identity scopes do not pay for tutor requests.
- **Local desktop plan usage:** an eligible open-source desktop distribution can dynamically register a local client and use the selected ChatGPT account's plan for local tutor inference. Tokens remain in Electron main and are never sent to Recall's backend or renderer.

Website client issuance is currently a limited partner trial. Complete OpenAI’s [Sign in with ChatGPT interest form](https://openai.com/form/sign-in-with-chatgpt-interest/) or contact your OpenAI representative. Obtain the client ID, exact registered callback URI and token endpoint authentication method from OpenAI; a confidential client also needs a secret. Implementation does not require these credentials to be checked into the repository.

## Website configuration

Set these server-only variables in `apps/web/.env.local` or your deployment secret manager:

| Variable                         | Value                                                         |
| -------------------------------- | ------------------------------------------------------------- |
| `OPENAI_SIWC_CLIENT_ID`          | Issued OAuth client ID                                        |
| `OPENAI_SIWC_REDIRECT_URI`       | Exact registered `https://your-host/auth/openai/callback` URI |
| `OPENAI_SIWC_CLIENT_AUTH_METHOD` | `none` or `client_secret_basic`, as registered                |
| `OPENAI_SIWC_CLIENT_SECRET`      | Confidential clients only                                     |
| `SIWC_STORE_REST_URL`            | Durable Redis REST endpoint                                   |
| `SIWC_STORE_REST_TOKEN`          | Server-only Redis REST credential                             |
| `SIWC_STORE_PREFIX`              | Optional environment namespace (default `recall:siwc`)        |
| `SIWC_IDENTITY_KEY_SECRET`       | Stable random secret, at least 32 characters                  |

The registered token-endpoint authentication method must be set explicitly; omitting it keeps the integration unavailable. The usual Supabase URL, publishable key and service-role key are also required. The public capability response contains only booleans. Missing configuration keeps the sign-in action unavailable. Development loopback callbacks may use HTTP; production callbacks use HTTPS.

First-party Supabase sessions use HttpOnly, Secure cookies in production with SameSite=Lax. Browser account and sync controls read a validated server session-status endpoint; session credentials are never returned by that endpoint. Sign-out clears the current Recall session and does not revoke the OpenAI identity or sign out other Recall devices.

The backend uses authorization code + S256 PKCE, browser-bound short-lived transactions, atomic one-time consumption, OIDC nonce and signed ID-token validation. Redis stores transaction verifiers temporarily and opaque identity mappings durably. Protect and back up this store along with the identity key secret; changing the key changes identity lookup. Use separate Redis databases or namespaces for environments.

Identity is keyed by issuer, issued client ID and subject. Claimed email addresses never automatically link accounts. Sign in to an existing Recall account first, then use **Link ChatGPT**. New ChatGPT identities receive an internal account address; account exports and deletion continue through Recall's canonical account APIs. Website identity tokens are discarded after verification.

### Activate an issued website client

1. Ask OpenAI to register the exact callback URI for each deployment environment and confirm `none` or `client_secret_basic`. A website identity client uses only `openid profile email`; request the separate local flow only for an eligible open-source desktop distribution.
2. Add the issued values to the server secret manager using the variables above. An OpenAI API key is not an OAuth client ID or client secret. Leave `OPENAI_SIWC_CLIENT_SECRET` unset for public clients.
3. Configure durable Redis with atomic `SET NX PX`, `GETDEL`, and `EVAL` support. Keep its credential and stable identity secret private and use a distinct prefix per environment. No database schema migration is needed for identity mappings.
4. Configure Supabase’s URL, publishable key and service-role key. New ChatGPT identities use internal canonical accounts; existing Recall users should sign in through their existing method and select **Link ChatGPT** first. Matching email addresses are never proof of account ownership.
5. Restart the deployment after changing server configuration. The sign-in button is enabled only when the whole configuration validates; `/api/v1/auth/openai/capabilities` exposes availability booleans and no credential values.

The application provides configured, unavailable, temporary provider/store failure, cancelled, expired, linking-conflict and successful-link states. Every start attempt clears previous temporary browser bindings before validating configuration; callbacks consume the durable transaction once and clear their browser binding on both success and failure. Credential issuance and live callback checks remain external activation steps; source implementation is available before those steps.

## Desktop configuration

Set `RECALL_CHATGPT_LOCAL_ENABLED=true` in `apps/web/.env.local` or the build shell before starting desktop development or building a desktop package. The flag is compiled into the main process; changing the environment when launching an existing package does not activate it. Rebuild the package to change this setting. Enable this only for a distribution eligible for OpenAI's documented local open-source flow. It uses dynamic client registration, not the website's OAuth client or secret. Users explicitly authorize plan usage and choose an account and an available model. Credentials are encrypted with Electron's OS-backed secure storage and written atomically with owner-only permissions. A secure encryption backend is required.

The desktop integration keeps a stable host identifier, persists issued client IDs, verifies reauthorization identity, rotates refreshed credentials and attempts remote revocation on sign-out. If no renewable token is available or revocation cannot be confirmed, local sign-out explicitly reports that remote revocation is unconfirmed. The local tutor validates model output through the existing tutor contracts and requires learner approval before adding a proposed card. ChatGPT plan limits are managed in [ChatGPT usage settings](https://chatgpt.com/settings/usage).

Only one desktop process can own the application profile, preventing competing refreshes of rotating tokens. Saved registrations receive persistent, distinct labels even when their emails match. Explicitly enabling plan tutoring requests consent again with the saved client ID; routine reauthorization does not force consent. Documented plan limit, eligibility, permission/region and temporary availability failures show the corresponding recovery action. Failures preserve credentials unless refresh confirms they are unusable, and never automatically switch billing to hosted tutoring.

Desktop recovery preserves the user’s selected billing source even after sign-out, permission failures or model-catalog outages. First plan sign-in shows the welcome confirmation even if loading models fails; reload available models explicitly after a catalog failure. A plan usage-limit response pauses further inference for that account for the running process; **Manage usage** opens ChatGPT settings, and **Retry after checking usage** explicitly releases the pause without guessing a reset time. Account changes and sign-out cancel current requests and invalidate already queued requests. Temporary refresh failures receive at most two additional attempts with bounded backoff; terminal refresh failures clear unusable credentials while retaining the registration. Renderer diagnostics contain only validated error codes, recovery categories, HTTP status, request identifiers and parameter names; provider error bodies and messages remain outside the renderer.

The desktop request surface uses `/v1/models` and streaming `/v1/responses` with `store: false`, selected catalog slugs and validated text tutor context. Only `response.completed` commits a result; partial, failed, incomplete and interrupted streams do not become tutor answers. Unsupported background/conversation controls, Files uploads, audio/video and undocumented native registration are excluded from this documented local integration. No website secret or OpenAI API key is required by the public desktop client. Activation still requires an eligible distribution, an eligible ChatGPT account/workspace, explicit grants and OS-backed secure storage.

Native mobile ChatGPT authentication remains unavailable because this implementation has no documented native mobile registration flow. Existing email authentication and hosted tutor access remain available.

## ChatGPT-plan capabilities and web research

The [current plan-access limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) explicitly allow web search, subject to model and account/workspace policy. They also allow supported text/image/file inputs and appropriately packaged function/custom tools. They exclude hosted image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors and Responses tool search. A website identity grant alone does not provide plan inference access.

Desktop **Research a topic** uses the selected account and model with the public Responses endpoint, `store: false`, `stream: true` and the `web_search` tool. Search is required; a completion without a completed search and valid source citations is not accepted as research. Only a terminal successful response supplies the displayed answer. Citation links come from provider annotations, never from URLs invented inside model-written JSON. Source opening verifies those provider-approved URLs in the main process. See [web-search protocol and citations](https://developers.openai.com/api/docs/guides/tools-web-search).

The form submits the query, not the entire learning area. Results stay in the current panel and are cleared when its account/model/area changes. New failures preserve the prior result; search does not write cards, update objectives or automatically feed a quiz. Model/policy, permission and usage failures have explicit recovery messages and do not change billing sources. Research still needs connectivity, eligible plan access and a distribution with desktop ChatGPT integration enabled.

## Validation status

Source compilation, lint and builds are tracked in the implementation plan. Actual OAuth callbacks, credential issuance, secure-storage behavior and direct inference require configured credentials and later runtime validation. No browser or live authentication run is part of this implementation pass.

## Official references

- [Website identity](https://developers.openai.com/siwc/website)
- [Request an OAuth client](https://developers.openai.com/siwc/request-client-id)
- [Local registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Local accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [UI guidance](https://developers.openai.com/siwc/ui-ux-guidelines)
