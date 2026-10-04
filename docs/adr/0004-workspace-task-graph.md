# ADR 0004: Workspace task graph

## Decision

Use pinned Turborepo 2.11.7 with pnpm to coordinate source checks and compilation. Every shared package has a strict TypeScript project and a `typecheck` task; shared packages publish source rather than requiring intermediate JavaScript builds.

`transit` tasks propagate source hashes through workspace dependencies without compiling those packages. App typechecks wait for dependency typechecks. App lint and build tasks include dependency source hashes. The root package lint task remains uncached so the complete package lint scan runs independently of app caches; `pnpm policy` separately checks source and schema policies.

Desktop consumes web source, so desktop checks/builds explicitly include web source and its dependency graph. Web Storybook consumes native mock components and the shared UI catalog, so its graph includes native source and shared package dependencies. Web checks also include the native sources imported by stories.

Build keys include the relevant public/API/provider environment variables and app environment files. Compiled Next.js output excludes runtime development and compiler caches; Electron caches `out`, native exports cache `dist`, and Storybook caches its static catalog. Development servers and platform installer packaging remain uncached.

## Commands

- `pnpm typecheck`: every shared package and app.
- `pnpm lint`: app lint in parallel plus the complete package lint scan.
- `pnpm build`, `build:desktop`, `build:mobile`: one client.
- `pnpm build:all`: all clients.
- `pnpm build-storybook`: the shared component and screen catalog.
- `pnpm exec turbo run typecheck --dry=json`: inspect the graph without launching applications.

## References

[Turborepo task configuration](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks) and [configuration reference](https://turborepo.dev/docs/reference/configuration).

Build environment hashes include native public configuration, ChatGPT local capability, hosted identity/store configuration and tutor retention/model settings. Desktop hashes its local ChatGPT capability flag because Electron main embeds it at build time. These inputs prevent reusing a bundle built for a different capability configuration.
