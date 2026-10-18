# TypeScript to .NET HTTP contract bridge

The Effect Schema definitions remain the source of truth for the existing `/api/v1` wire contract. A .NET implementation should consume generated JSON Schema and shared JSON fixtures, then add C#-specific semantic validation where JSON Schema cannot express the existing behavior. Do not hand-maintain a second description of each TypeScript contract.

## First contract slice

The initial migration slice is:

- `GET /api/v1/auth/session` response: `AuthSessionResponseSchema` in `packages/contracts/src/auth-session.ts`.
- `GET /api/v1/workspace` response: `WorkspaceSnapshotSchema` in `packages/contracts/src/workspace-content.ts`, including nested `KnowledgeAreaSchema` from `packages/domain/src/index.ts`.

Example payloads live in `contracts/fixtures/dotnet-v1/`. They are ordinary JSON so both TypeScript and .NET can load the same files. The fixtures cover authenticated and anonymous sessions, an empty workspace, and a populated workspace. IDs are stable UUIDs and timestamps are canonical UTC strings.

## Export and verification workflow

Run these commands from the repository root (Node.js 22, pnpm 10, and .NET 10):

```sh
pnpm contracts:generate
pnpm contracts:check
pnpm --filter @recall/verification test dotnet-contract-parity.test.ts
dotnet run --project backend/Recall.ContractChecks -- .
```

The exporter uses the verification package's declared esbuild dependency to execute a typed
entrypoint. It calls Effect's `JSONSchema.make` for both response schemas and writes deterministic,
checked-in files under `contracts/generated/`. `contracts:check` fails if either file is missing or
stale. Commit regenerated schemas alongside intentional contract changes. Regexes use explicit
uppercase/lowercase ranges because JSON Schema patterns do not preserve JavaScript regex flags.

The shared `contracts/fixtures/dotnet-v1/manifest.json` records each fixture's contract, expected
schema validity, and expected final validity. Both runners load these same JSON files. Cases cover
anonymous/authenticated sessions, uppercase identities and hashes, empty/populated workspaces,
malformed UUIDs, versions, hashes, colors, missing fields, media, and broken objective references.
TypeScript checks shapes with `Schema.decodeUnknownEither` and rejects excess properties; workspace
semantic checks use the existing `parseKnowledgeAreaJson`. The .NET runner consumes the generated
schemas with JsonSchema.Net, then runs the existing `ContractBoundaryValidator` semantic checks.
The fixture suite exposed and now guards a missing-session-field crash in that validator.

JSON Schema covers serializable shape constraints, not every Effect filter, transformation, or
cross-field invariant. The bounded activity JSON declaration carries an explicit annotation;
its depth, traversal, and payload-size limits remain runtime checks. Broken objective references
are deliberately schema-valid but semantically invalid. C# retains its runtime boundary validator;
this initial fixture corpus verifies the listed cases rather than proving complete semantic parity.
Add paired fixtures whenever either implementation changes. The backend CI workflow checks schema
freshness, runs both fixture validators, builds the solution, and verifies the live OpenAPI document.

The C# wire DTOs should use explicit JSON property naming and strict unknown-value handling at the HTTP boundary. Keep incoming JSON as `unknown`/untrusted until validation succeeds. In particular, preserve null versus omitted fields: anonymous auth responses require `displayLabel: null` and `ownerId: null`, while the authenticated response requires both values.

## Fixture maintenance

Update fixtures alongside intentional contract changes. A fixture change should include the corresponding Effect schema change and a .NET parity check. The fixtures are examples, not replacements for exhaustive boundary tests or generated OpenAPI documentation.
