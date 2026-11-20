# Restricted Lua prototype

`@recall/infra-lua/node` exports `createNodeLuaRuntime()`. Its `invoke` returns an
Effect with typed `LuaRuntimeFailure`. The root entry exports the port and
`createUnavailableLuaRuntime()` for environments without isolated execution.
Browser and React Native clients should use the authenticated online transport;
they cannot execute this Node worker adapter locally.

A script returns a table with `init(configuration, seed)`, `view(state)`,
`update(state, event)` and `assess(state)`. Each invocation starts a fresh VM.
Persist explicit JSON state and replay events; closure state does not persist.
Only a restricted environment and seeded `random()` are exposed. No IO, OS,
package loading, debug, coroutine, dynamic loading, JS interop, account objects,
network, or filesystem APIs are exposed to activity code. `json_null` represents
JSON null; arrays use 1-based indexes and an empty table returns an object.
The host must validate the semantic view/assessment schema before rendering or
accepting results. Scripts remain untrusted content.

```lua
return {
  init = function(configuration, seed) return {count = 0} end,
  view = function(state) return {text = tostring(state.count)} end,
  update = function(state, event) return {count = state.count + 1} end,
  assess = function(state) return {passed = state.count >= 3} end
}
```

## Standalone transport

`node packages/infra-lua/runtime/cli.mjs` reads one JSON object on stdin:
`{script, configuration, seed, operation, state?, event?}`. It writes one JSON
object: `{ok:true,value,version}` or `{ok:false,error:{code,message},version?}`.
The stable executor version is `recall-lua-wasmoon-1.16.0-v1`.

Build with `docker build -t recall-lua-runner:1 packages/infra-lua`. The calling
service must run the image with network disabled, read-only filesystem, no
capabilities, no privilege escalation, a process limit, memory and CPU limits,
and its own outer kill deadline. Do not mount credentials, host paths or Docker
socket into the runner. The image is a non-root standalone stdin/stdout process.
The Docker build was not run during implementation.

## Enforced budgets

A dedicated worker uses a parent-controlled 1500ms wall deadline; termination
also covers execution inside library calls. A private debug count hook permits
100,000 Lua VM instructions. Activity code cannot replace or catch the hook.
The Wasmoon allocator rejects Lua allocations above 4MiB. The Node worker also
has 32MiB old heap, 8MiB young heap and 2MiB stack limits. These are VM allocation
and V8 heap limits, **not a total process RSS cap**; use the container memory
limit for that boundary. Inputs are at most 64KiB, source 32KiB, output 32KiB,
JSON depth 16 and each output table at most 2048 entries. No host functions or
objects are registered with the Lua environment. WASM alone is not the sandbox.

## Engine evaluation

Selected **Wasmoon 1.16.0**, pinned in the manifest/lockfile. Its allocation tracer
supports `setMemoryMax`, unlike **Fengari 0.1.5**, whose Lua heap uses JS GC and
whose documented `lua_gc` is unimplemented. Both need a restricted environment
and external termination. Wasmoon adds a WASM deployment asset and cannot run in
Hermes directly; Fengari is JavaScript and more portable, but offers no equivalent
Lua allocation boundary. Neither establishes an enforceable browser-worker total
memory cap. Therefore this prototype proves Node/container execution and exposes
explicit local-unavailable capability for mobile/browser rather than claiming a
cross-platform local sandbox. No Fengari runtime dependency is added.

Sources: [Wasmoon allocator](https://github.com/ceifa/wasmoon/blob/v1.16.0/src/global.ts),
[Wasmoon engine](https://github.com/ceifa/wasmoon/blob/v1.16.0/src/engine.ts),
[Fengari limitations](https://github.com/fengari-lua/fengari/blob/v0.1.5/README.md).

Run focused evidence with `pnpm --filter @recall/infra-lua test`. Tests exercise
lifecycle, deterministic inputs, forbidden API access, finite infinite-loop
termination, allocator exhaustion, JSON escaping/null, cycles and output caps.
