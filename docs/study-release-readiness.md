# Study release validation

The local Supabase database now records the complete split initial chain and the
study migrations through `20261024000000_atomic_linked_notes.sql`. These checks
were local. The subsequent hosted setup is documented in [free hosting](free-hosting.md).

## Reconciling the legacy local database

The existing database recorded the former consolidated initial schema as one
migration. Replaying the later split files would recreate existing objects.
Before repairing the ledger:

1. Save a restricted full database backup with `pg_dump -Fc`.
2. Build the initial migration chain in a separate reference database. Compare
   its public catalog with the existing database, including functions, tables,
   policies and grants. Supabase's platform default privileges differ from a
   bare reference database; preserve those existing platform defaults.
3. Only after confirming the application catalogs match, record the already
   present split migrations using `supabase migration repair --local --status
applied` with their exact versions.
4. Apply the new study migrations in order. Check the migration list and the
   original application row counts. Do not reset the existing database.
5. Restore the backup into a separate scratch database and verify its contents.
   Supabase-owned platform functions require the local `supabase_admin` role
   during a complete restore.

The repair performed here preserved 13 existing areas, two reviews and 16 Auth
users. Restoring the pre-change backup into a scratch database reproduced those
counts. Backup files remain outside the repository with restricted permissions.

Do not mark migrations applied on another database merely because these version
numbers match. Repeat the catalog comparison there or apply the chain normally
to a fresh database.

## Repeatable runtime checks

Build the Release API, then run the isolated local verifier:

```sh
dotnet build backend/Recall.Api --configuration Release
python3 backend/scripts/verify-api.py --study --local-supabase --port 5020
```

The verifier captures loopback Supabase configuration without printing keys,
starts the API, creates scoped test users, runs authenticated checks and cleans
up its fixtures. It checks OpenAPI, content authoring, study revision conflicts,
append-only metadata, 5,001 entries across real pagination, account isolation,
reviewed-card movement and idempotent retries, and atomic linked-family writes.

Database fixtures under `supabase/tests/` check study metadata and atomic linked
notes inside rollback transactions. CI runs the HTTP study verifier alongside
publishing acceptance.

Hosted release still needs an explicit target, that environment's backup and
migration review, and its configured authentication, Redis and proxy acceptance.
See [the deployment runbook](deployment-runbook.md).
