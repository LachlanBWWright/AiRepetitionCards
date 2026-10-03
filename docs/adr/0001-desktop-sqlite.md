# ADR 0001: Desktop SQLite binding

## Decision

Use Node's built-in `node:sqlite` `DatabaseSync` from the Electron main process. Pin the Electron runtime to 44.5.1 so the application controls the bundled Node runtime and avoids a native add-on ABI rebuild for each Electron release. The renderer receives only workspace read, validated write, and clear commands through the preload bridge.

## Trade-offs

The Node SQLite API is still marked Release Candidate, so Electron upgrades must be reviewed and the workspace store must remain behind its adapter. Synchronous operations are acceptable for the current single-row workspace snapshot; move to an asynchronous repository or utility process if database work grows enough to block the main process.

## Security boundary

SQLite stays in the main process. IPC validates the main frame and decodes the workspace before writing. Renderer Node integration is disabled, context isolation and sandboxing are enabled, and no SQL is exposed to the renderer.
