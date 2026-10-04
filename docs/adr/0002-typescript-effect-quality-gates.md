# ADR 0002: TypeScript and Effect quality gates

- Status: accepted
- Date: 2026-10-03

## Decision

All clients and shared packages use strict TypeScript, including unchecked-index protection and exact optional property types. ESLint uses `typescript-eslint`'s `strictTypeChecked` rules with project service; Prettier owns formatting. CI runs these checks and the source policy scan.

Expected asynchronous and boundary failures use Effect's typed error channel. Adapters translate rejected vendor operations at the boundary. Expected failures do not use `throw`; authored source may not use inline lint or TypeScript suppressions. External data enters as `unknown` and is schema-validated.

The scheduler's only current lint exception is the package-level `no-deprecated` rule for `ts-fsrs` v5's `Card.elapsed_days`, which the API still requires. Remove that exception when migrating to v6 and its replacement field/API.

## Consequences

New app and shared-package code is checked for type-aware promise misuse, unsafe values, exhaustiveness, and unnecessary assertions. A narrowly scoped rule exception belongs in ESLint configuration with a reason; inline suppressions remain prohibited.
