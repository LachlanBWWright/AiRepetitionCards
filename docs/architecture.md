# Architecture

Clients compose portable learning operations with platform adapters. Ordinary review works offline without an AI provider or account.

## Package boundaries

The internal import graph is enforced by `scripts/check-policy.mjs`, alongside framework/vendor restrictions and the prohibition on authored exception control flow and inline suppressions.

| Package                         | Allowed workspace dependencies                                |
| ------------------------------- | ------------------------------------------------------------- |
| domain                          | None                                                          |
| contracts, ai-core, local-store | domain                                                        |
| sync-core                       | domain, contracts                                             |
| scheduler                       | domain, sync-core                                             |
| application                     | domain, scheduler, sync-core, ai-core, contracts, local-store |
| infra-openai                    | ai-core, application, contracts, domain                       |
| infra-supabase                  | ai-core, application, contracts, domain, sync-core            |
| design-tokens                   | None                                                          |
| ui-web, ui-native               | design-tokens                                                 |

Subpath imports follow their owning package's rules. Self imports are allowed. Storybook development dependencies remain available to package-owned stories; production UI remains independent of app frameworks and data providers.

Domain owns immutable learning data and canonical Effect schemas. Scheduler transitions require explicit time and preserve append-only review history. Application operations validate unknown input and expose typed Effect failures through ports. Infrastructure adapters classify vendor failures. Next.js, Expo and Electron compose adapters and translate results into platform behavior.

## Storage and synchronization

Web persists its workspace in IndexedDB through `WorkspaceStore`, and attachments in a separate IndexedDB media adapter. Electron selects the same port through validated IPC to main-process SQLite. Expo composes SQLite and secure credential adapters. Corrupt or newer workspace caches are retained until explicit reset; successful writes cannot silently overwrite them.

Review outboxes, causal ordering, replay and tombstones are portable. Content conflicts require learner approval. API contracts validate envelopes and response identities before application state changes. Supabase remains the canonical hosted identity and owner-scoped persistence provider; service credentials stay at server boundaries.

## AI and identity

`ai-core` defines provider capabilities and validated output shapes. `infra-openai` implements hosted inference and website OIDC verification. AI proposals require application validation and explicit approval before cards become durable learning content. User-authored instructions and imported material remain untrusted.

Website ChatGPT sign-in creates or links a canonical Supabase session. Eligible desktop ChatGPT-plan inference keeps credentials in the Electron main process and exposes narrow IPC operations. Hosted and local inference own conversation context rather than relying on provider response IDs. See [the integration guide](sign-in-with-chatgpt.md).

## Presentation

`ui-web` contains reusable DOM primitives for Next.js and Electron. `ui-native` shares semantics and token constants while using native controls. App wrappers own media, HTTP and framework behavior. Full-screen Storybook stories use deterministic mock data and fixed time, with capture registrations maintained separately from actual browser capture.

## Shared workflows and verification

Tutor preparation, provider dispatch, schema/objective validation and quiz/proposal transitions are shared application operations used by hosted and local tutoring. HTTP authentication, quota/metering and ordered persistence remain composition boundaries. Workspace sync orchestration and reconciliation share application use cases across web and native clients. The shared web UI has a source-owned shadcn/Radix foundation and semantic Tailwind theme. Canonical tokens generate both immutable TypeScript for native and CSS variables for web. The native composition root pins NativeWind 4.2.7 and its Expo-compatible peers, with a Tailwind 3 theme using the same canonical token source. Native primitives retain StyleSheet semantics for their browser Storybook renderer. Source completeness does not prove device, browser, authentication, RLS or multi-device runtime behavior.
