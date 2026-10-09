# TypeScript to .NET HTTP contract bridge

The Effect Schema definitions remain the source of truth for the existing `/api/v1` wire contract. A .NET implementation should consume generated JSON Schema and shared JSON fixtures, then add C#-specific semantic validation where JSON Schema cannot express the existing behavior. Do not hand-maintain a second description of each TypeScript contract.

## First contract slice

The initial migration slice is:

- `GET /api/v1/auth/session` response: `AuthSessionResponseSchema` in `packages/contracts/src/auth-session.ts`.
- `GET /api/v1/workspace` response: `WorkspaceSnapshotSchema` in `packages/contracts/src/workspace-content.ts`, including nested `KnowledgeAreaSchema` from `packages/domain/src/index.ts`.

Example payloads live in `contracts/fixtures/dotnet-v1/`. They are ordinary JSON so both TypeScript and .NET can load the same files. The fixtures cover authenticated and anonymous sessions, an empty workspace, and a populated workspace. IDs are stable UUIDs and timestamps are canonical UTC strings.

## Export and verification workflow

The current .NET boundary validator is `backend/Recall.Api/Contracts/ContractBoundaryValidator.cs`. It validates the checked-in fixture names against the auth and workspace response shapes, including Knowledge Area fields, card variants, media bounds, objective references, and prerequisite uniqueness/cycles. The TS exporter remains a follow-up: this checkout has no declared TypeScript runtime loader for executing a script that imports the Effect schemas, so generation should be added alongside an explicit supported runner rather than relying on a transitive tool.

When added, the exporter should import the schemas above and use Effect's `JSONSchema.make(schema)` to write named schema files into a generated contract directory. Keep generation deterministic, strip generator-only metadata only when it does not affect validation, and review diffs whenever the Effect or schema version changes. JSON Schema is a useful cross-language shape/constraint format, but it does not replace the runtime behavior of `Schema.decodeUnknown`; preserve any transformations, filters, brands, and cross-field rules in explicit C# validators.

The validator exposes `ValidateDotnetV1Fixture` for use by a small fixture runner. A runnable shared positive and negative corpus is not yet wired: TypeScript should validate fixtures with `Schema.decodeUnknownEither`, and .NET should validate the same paths with this validator. Add negative cases for malformed account UUIDs, wrong schema versions, invalid hashes/colors, missing required fields, invalid Knowledge Area versions, malformed media, and broken objective references. Preserve the API's existing error envelope separately from successful schema validation.

The C# wire DTOs should use explicit JSON property naming and strict unknown-value handling at the HTTP boundary. Keep incoming JSON as `unknown`/untrusted until validation succeeds. In particular, preserve null versus omitted fields: anonymous auth responses require `displayLabel: null` and `ownerId: null`, while the authenticated response requires both values.

## Fixture maintenance

Update fixtures alongside intentional contract changes. A fixture change should include the corresponding Effect schema change and, once available, a .NET parity check. The fixtures are examples, not replacements for exhaustive boundary tests or generated OpenAPI documentation.
