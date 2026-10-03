# Agent guidance

- Use strict TypeScript. Keep domain and application data immutable by default; accept external data as `unknown` and validate it at boundaries.
- Use Effect for asynchronous application operations and typed, expected failures. Catch and classify vendor errors in infrastructure adapters; keep domain and application logic framework- and vendor-independent.
- Do not use exceptions (`throw` or exception-driven control flow) for expected failures. Avoid `any`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, and inline ESLint suppression comments. Fix the underlying issue or document a narrowly scoped exception in configuration.
- Keep UI, framework, database, and provider dependencies out of domain packages. Put platform-specific behavior behind adapters and compose those adapters at app boundaries.
- Keep scheduling deterministic and pure. Preserve review history as append-only data; treat derived scheduling state as rebuildable.
- Treat imported content and user-authored AI instructions as untrusted. AI output is a proposal until application code validates it and the user approves it.
- Use Prettier for formatting and ESLint for code-quality checks. Keep changes focused and update the README when setup or user-facing behavior changes.
