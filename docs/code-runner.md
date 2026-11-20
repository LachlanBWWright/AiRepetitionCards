# Coding execution

Coding execution requires a host with Docker CLI access to a Docker daemon and a
prebuilt local image. Neither the web nor .NET server builds or downloads images
when a learner presses Run. Build once on the execution host:

```sh
docker build -t recall-code-runner:2 apps/web/code-runner
pnpm --filter @recall/verification test:code-runner activity-code-runner.test.ts
```

`RECALL_CODE_IMAGE` may select a compatible preinstalled image (default
`recall-code-runner:2`). Version 1 is incompatible with the shared supervisor.
The image contains Node 22, Python 3, Rust and cached serde_json 1.0.145 libraries.
Building the image downloads packages; running learner code has no network.
Docker-based execution is optional and is unavailable on hosts without Docker,
including ordinary serverless web deployments. The endpoint returns an unavailable
error; clients retain the solution and allow saving/leaving or retrying later.
There is no in-process learner-code fallback. No services need deploying to build
or test this image locally.

Both server adapters invoke the same image-owned `/runner/runner.py`. It compares
JSON values in a supervising process; each learner process receives only test
inputs. The public API is authenticated POST `/api/v1/activities/execute` with
`{activity,response,executionMode?:"run"|"submit"}`. Omission defaults to Submit.
Run uses `exampleTests` when nonempty, otherwise `tests`; Submit uses `tests`.
Both return `{passed,total,failures,status,diagnostics,runtimeMs}`. The original
three result fields remain supported. `passed` status means all selected tests
passed; `failed` means a wrong answer; `error` includes compilation/runtime/output
errors; `timeout` includes compilation/execution timeouts. Compilation failures
are identified in `failures` and include bounded compiler `diagnostics`.
Infrastructure/unavailable/invalid-runner-output failures are HTTP errors.
The compatible `/assess` route still returns an assessment using Submit tests.
Neither endpoint saves attempts or changes review scheduling.

All activity tests, including Submit tests, are downloaded public activity data.
They are examples of correctness, not secret tests or proof of complexity bounds.
There is no hidden-test storage or hidden-test feature.

## Function contracts

`tests` and optional `exampleTests` contain `{input:[...arguments],expected:json}`.
Results are compared structurally, with object-key order ignored and booleans
distinct from numbers. JavaScript/Python numbers compare by JSON numerical value.
Synchronous JSON functions are supported; asynchronous results are not awaited.

- JavaScript: `function solve(values) { return values.reduce((a,b) => a+b,0); }`
- Python: `def solve(values): return sum(values)`
- Rust: `fn solve(values: Value) -> Value { json!(values.as_array().unwrap().iter().map(|v| v.as_i64().unwrap()).sum::<i64>()) }`

Rust arguments and return values use `serde_json::Value`; `Value` and `json!` are
provided by the wrapper. Rust tests must use a consistent argument count matching
the authored function signature. No external crate resolution occurs at runtime.
JavaScript runs in a fresh VM context per test without Node APIs and with string
and WASM code generation disabled. The Docker container, rather than VM alone,
is the isolation boundary. Python and Rust may use their image-installed standard
libraries within the same container restrictions. Print output is bounded and
interferes with the JSON return protocol; return the answer instead.

## Bounds and cleanup

Compilation has a 15-second wall budget. Execution has an 8-second aggregate
budget and at most one second per test (JavaScript VM calls also have 500ms
limits). The server bounds the entire Docker invocation at 30 seconds and cleanup
at five seconds. Each execution uses a unique disposable container with no
network, read-only root, dropped capabilities, no new privileges, nonroot UID,
32 processes, 512MiB memory/swap total, half a CPU, 64 file descriptors, and a
64MiB executable temporary filesystem (needed for the compiled Rust program). Temporary files and learner subprocess groups are
removed; adapters force-remove the named container after success, failure,
timeout or cancellation. Per-process stdout/stderr streams are limited to 64KiB;
server response output is capped at 64KiB. Requests are capped at 200KB.
Compiler diagnostics are truncated and contain no host secrets.
