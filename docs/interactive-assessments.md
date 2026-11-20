# Interactive assessments

Activities collect evidence about an objective separately from card scheduling. Ordering,
matching and code tracing use deterministic local assessment. Coding and Lua require
an available isolated executor. An assessment result is a proposal: accepting it records
one immutable attempt. Returning to a review card and explicitly choosing its rating is
a separate action. Run, Submit, hints and game actions do not rate a card.

## Platform and connectivity

The following is the implementation contract. UI composition and deployment must be
verified independently; an available plugin is not evidence that a runner is deployed.
Electron uses the web activity UI and the configured web/API service.

| Activity                         | Web / Electron                                  | React Native                                                 | Offline                                                                |
| -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Ordering                         | Shared deterministic plugin; web controls       | Shared plugin; native controls                               | Local presentation, responses and assessment                           |
| Matching                         | Shared deterministic plugin; web controls       | Shared plugin; native controls                               | Local presentation, responses and assessment                           |
| Code tracing                     | Text-only source and output entry               | Text-only source and output entry                            | Local assessment; source is never executed                             |
| Coding: JavaScript, Python, Rust | Authenticated isolated server runner            | Authenticated configured API runner                          | Author/read problem and retain solution; execution unavailable         |
| Lua                              | Authenticated transport to isolated Node worker | Requires configured authenticated transport to Node executor | Retain script, fallback and unfinished response; execution unavailable |
| Account synchronization          | Requires authenticated API                      | Requires authenticated configured API                        | Local saves only; no claim of account synchronization                  |

Lua's proven execution boundary is Node, not browser or native in-process evaluation.
The integration injects a runtime port; an unavailable port fails explicitly. Hosted Lua
requires the authenticated `/api/v1/activities/lua` route and its runtime dependency.
Do not infer native API deployment from the presence of a web route. Runner images,
Node Lua dependencies, authentication and network connectivity are deployment
prerequisites. Failure must preserve the draft and offer the activity fallback.

Local persistence depends on the enclosing application's confirmed save. Browser tab
storage, device storage and account synchronization have different lifetimes. A failed
save is not durable; keep the workspace open and retry. Switching accounts must bind
requests and save callbacks to the selected owner; library JSON itself has no owner field.

## Response and history contracts

Activity libraries use `version: 1`. Activity snapshots include plugin version and content
revision. A draft retains its original activity snapshot, response, stage and timestamps.
New content does not silently rewrite that draft or historical accepted evidence. A stale
completion must restart against current content; its original work remains available.
A retry of an identical accepted attempt ID is idempotent. Reusing that ID with different
content conflicts. Starting a distinct attempt intentionally produces a distinct history item.

Ordering submits the complete permutation of item IDs in `selectedOptionIds` and no
answers. Its initial presentation must differ from authored solution order. Matching
submits one canonical JSON object mapping left IDs to right pair IDs in `answers[0]`,
with empty `selectedOptionIds`. Presentation order does not define correctness.
Tracing normalizes CRLF/CR to LF, trailing whitespace on each line and trailing empty
lines; it preserves leading whitespace and letter case.

Optional interaction metadata uses `seed`, `firstTry`, `hints`, `retries` and bounded
`actions`. Hints cannot be reported as unassisted evidence, and retries cannot claim a
first try. This is learner/device evidence, not a tamper-proof examination record.

Coding keeps the `solve(...inputs)` JSON test contract. JavaScript defines `solve`,
Python defines `solve(*inputs)`, and Rust uses `serde_json::Value` inputs and output
with the runner's supported signature. Run uses examples when supplied; Submit uses
the authored downloaded tests. Neither operation accepts an attempt. Tests delivered
with activity content are public, not hidden or secret. Compiler diagnostics, timeout,
wrong answers and unavailable infrastructure must remain distinguishable.

Lua renders bounded JSON text/buttons through host controls. No arbitrary DOM or host
objects belong in the script interface. Persisted state is untrusted: assessment replays
approved events from initialization with the recorded seed/runtime version. Runtime or
seed changes require a fresh attempt. A script's deterministic score is still authored
content; it is not an independent proof that the learner understood the subject.

## Acceptance commands and evidence

Run selected checks through the bounded verification runner from the repository root:

```sh
pnpm --filter @recall/verification exec node scripts/run.mjs activities/interactive-acceptance.test.ts activities/interactive-acceptance-account.test.ts activities/interactive-acceptance-games.test.ts activities/interactive-acceptance-lua.test.ts
pnpm test:code-runner
pnpm check:source-limits
```

The first command exercises draft versioning, stale revisions, provisional assessment,
idempotent completion, execution modes, owner-bound browser headers, malformed Lua
views, replay against forged saved state, and unavailable services. The account test
mocks HTTP: it checks adapter binding and rejection propagation, not database row-level
security or real account switching. Lua acceptance uses an injected deterministic test
port: it verifies host validation/replay, not the Wasm sandbox. Docker runner checks
require the configured runner image and Docker; no full builds are needed for these
selected application checks.

Actual sandbox containment additionally requires adversarial executor tests for host
capabilities, filesystem/network/process access, infinite loops, memory and output
limits, and cleanup. Browser/native reviewer checks must confirm that opening an
activity pauses automatic review and that accepting evidence leaves scheduling unchanged
until the learner chooses a rating. The application tests alone cannot establish those
UI, database, operating-system isolation or deployed-platform guarantees.

Verified locally: the bounded application regression suite passed (665 passed, one
skipped), all eight Docker coding checks passed, and all five Lua runtime checks
passed. Authenticated ASP.NET/Supabase checks exercised real Lua execution,
nontermination rejection, account isolation and Run/Submit without automatic attempt
acceptance. These checks do not establish physical-device behavior or deployment.

```sh
docker build -t recall-lua-runner:1 packages/infra-lua
pnpm --filter @recall/infra-lua test
python3 backend/scripts/verify-api.py --interactive --local-supabase --port 5020
```

Browser checks passed for ordering/restored responses, review suspension, explicit acceptance, preservation of unrelated activities, coding Run/Submit and Lua host actions. Browser coding/Lua stories inject deterministic runtime replies; separate authenticated API and Docker tests exercise actual execution. Run apps/web/tests/e2e/interactive-activities.test.mjs against Storybook with RECALL_E2E_URL and RECALL_E2E_STORYBOOK_URL pointed to the same local origin.
