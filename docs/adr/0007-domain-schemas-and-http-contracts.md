# ADR 0007: Domain schemas, boundaries and HTTP contracts

Status: accepted.

## Decision

- Domain owns immutable learning data and canonical Effect Schema definitions. IDs are branded and validated at external boundaries. Application services depend on ports; framework, UI and vendor adapters stay outside domain/application. The static source policy enforces both vendor imports and the internal workspace package graph.
- Effect Schema is the schema source. JSON Schema for hosted Structured Outputs is generated from those schemas. No second Zod model is maintained.
- Use readable Next Route Handlers for HTTP composition. Shared versioned contracts and Effect clients validate requests, successful responses and identity relationships. Expected failures remain typed values and are mapped to HTTP at the boundary; unexpected failures receive sanitized responses and request IDs.
- Knowledge Area JSON is canonical portable content. Versioned codecs explicitly adopt supported older versions and reject unknown versions. Media ZIP manifests describe bounded paths, MIME, size and digest; personal learning state belongs only in private workspace backups.

## Consequences

A new platform reuses the domain, application, contracts and scheduler. A new HTTP or provider adapter must preserve validation and failure semantics. Unsupported schema versions are recoverable import/cache errors and cannot be overwritten implicitly.

See [architecture](../architecture.md), [Knowledge Area schema](../knowledge-area-schema.md), and [publishing contracts](../publishing-http.md). Runtime contract/security acceptance remains separate from source checks.
