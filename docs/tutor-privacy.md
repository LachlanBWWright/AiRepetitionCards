# Tutor transcript privacy

Tutor sessions contain private messages, AI observations, area snapshots, and proposal records. Approved cards and append-only review history are independent learning records and survive tutor-history deletion.

## Deployment configuration

- `TUTOR_TRANSCRIPT_RETENTION_DAYS`: days since the last tutor-session activity, default `30`, supported range `1`–`365`. Set `0` to retain until explicit erasure.
- `TUTOR_RETENTION_JOB_SECRET`: a separate 32–4096 character printable non-whitespace secret for manually scheduled POST cleanup.
- `CRON_SECRET`: a separate secret with the same bounds for Vercel's scheduled GET cleanup.
- `TUTOR_RETENTION_BATCH_SIZE`: sessions examined per invocation, default `250`, supported range `1`–`1000`.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only privilege required for erasure; never expose it to a browser or desktop renderer.

Invalid retention configuration disables policy responses and scheduled cleanup. Missing administrative credentials disable erasure. No database schema changes are required.

## Authenticated learner operations

`GET /api/v1/tutor/privacy` returns the versioned retention policy and whether erasure is configured. `DELETE /api/v1/tutor/privacy` requires the signed-in owner, a same-origin browser request (or authenticated desktop bearer request), and JSON `{ "confirmation": "DELETE_TUTOR_HISTORY" }`. It removes that owner's tutor sessions and their cascaded messages, observations, and proposal records. The response acknowledges completion and reports the session count. Application code validates this acknowledgment before clearing local tutor state.

Deletion includes proposal metadata for approved cards; the independently approved cards themselves remain. AI usage accounting remains separate. Provider-side retention and application backups are governed independently. Local-only desktop tutor history must be erased through the desktop controls.

## Scheduled cleanup

Configure the deployment scheduler to send `POST /api/internal/tutor-retention` with `Authorization: Bearer <TUTOR_RETENTION_JOB_SECRET>`. This endpoint uses a constant-time comparison of fixed-length secret digests. It selects the oldest expired sessions with a bounded batch, deletes with explicit owner filters, and rechecks the activity cutoff at deletion so sessions renewed during selection are preserved. Each invocation reports a versioned count. A batch can span multiple owners; a later failure may occur after earlier owner deletions, so retries are safe and idempotent.

[`apps/web/vercel.json`](../apps/web/vercel.json) schedules `GET /api/internal/tutor-retention` daily at 03:00 UTC on the deployed production project. Set `CRON_SECRET` in Vercel's production environment; Vercel sends it in the bearer authorization header, and the GET handler checks only that secret. The manual POST handler continues to check `TUTOR_RETENTION_JOB_SECRET`. Both share the existing bounded, owner-filtered cleanup. See [Vercel's cron authentication documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).

Deployment and administrative credentials are required before the job can execute. One invocation removes at most the configured batch; repeat manual POST invocations to drain a backlog. Expiry is applied when the job runs. Changing the day limit affects the next invocation; setting `0` disables deletion while preserving explicit erasure. The deployment scheduler has not been exercised in this implementation session.

## Optional subject conversation retention

Subject Tutor starts in session-only mode. **Keep this conversation on this device** explicitly
opts into saving the latest 50 exchanges and the current draft, scoped to the Recall account,
AI provider/account and subject. Browser/Electron retention uses device-local browser storage with
a cross-tab write lock; native retention uses SQLite with the native write/erasure lane. Stored
JSON is validated and bounded before use. Conflicting writes and corrupt records are preserved
rather than silently overwritten. Account/provider changes remount the conversation scope.

Turning retention off or choosing **Delete conversation and start fresh** deletes the saved record
and clears the open conversation. Local-data erasure also removes retained records. Messages are
excluded from content sync, published decks, workspace backups and account exports. This option
controls local storage only: submitting a follow-up sends the selected bounded conversation context
to the chosen AI provider, and provider-side processing/retention remains subject to that provider.
Storage errors leave the open conversation available and show an error; an unavailable local store
does not require enabling retention to use a session-only conversation.
