# Daily-use and release acceptance

## Automated local journey

```sh
pnpm --filter @recall/verification test daily-use-acceptance.test.ts desktop-crash-recovery.test.ts desktop-upgrade-backup.test.ts media-transfer-recovery.test.ts desktop-update-workflow.test.ts desktop-update-preflight.test.ts
pnpm --filter @recall/verification test study-day-and-learning.test.ts conversation-retention.test.ts review-repair.test.ts sync-status.test.ts
```

The daily-use journey opens two separate on-disk SQLite databases using the actual desktop snapshot
codec and the shared application sync/review/backup workflows. It proves restart preserves offline
answers, rejected authentication retains pending work, a lost response can be retried without duplicate
reviews, concurrent reviews survive on both clients, conflicting content remains local until an
explicit resolution, and verified image bytes and append-only reviews survive a private backup restore.
Additional fault tests terminate a real Node process with SIGKILL while the actual desktop adapter
is inside a SQLite write transaction, reopen the on-disk WAL database and verify the last acknowledged
snapshot and a successful subsequent save. Native manifest/chunk reads (including checkpoints) now use one
exclusive read transaction. A deterministic two-connection Node SQLite WAL regression holds a read after
its manifest lookup, commits a concurrent save, and verifies the read cannot mix snapshot generations. Desktop clearing is atomic across the workspace and
recovery archives. Desktop and native SQLite use FULL synchronous writes and a bounded busy timeout.
Upgrade tests open actual SQLite recovery copies and compare workspace and media bytes. These tests
cover process loss, not physical power loss or every filesystem/device implementation.

Media synchronization now persists each verified download before requesting the next asset. A failed
later transfer retains earlier verified bytes, and retry fetches only missing assets. The regression
injects an unavailable gateway midway through a batch and checks retained bytes and request counts.

The server/auth/media transport is an isolated model with revision checks and retained mutations;
this is executable local acceptance, not evidence of Expo device storage or a production server.

Sync indicators distinguish device/tab state, pending work, an in-flight request, conflicts/errors,
and confirmation of the latest workspace. A local save is never displayed as account confirmation.
Network/authentication failures retain existing retry and recovery actions.

## Real API acceptance

After building Release and applying the configured local migrations:

```sh
dotnet build backend/Recall.Api --configuration Release
python3 backend/scripts/verify-api.py --study --local-supabase --port 5020
```

The existing isolated HTTP verifier now also saves and reads the new scheduling controls through
independent requests, and rejects invalid rollover hours, look-ahead windows and leech actions.
The Supabase integration CI workflow runs these HTTP checks. Its scoped fixture users are removed
when finished; existing user workspaces are not reset.

## Signed-device and hosted release gate

Before shipping a candidate, record its commit, artifact checksum, OS/architecture, API environment,
and test date. Install the signed download on clean desktop accounts and physical iOS/Android
devices, then complete this journey with one account:

1. Create cards with image/audio attachments and review on desktop.
2. Synchronize, disconnect the phone, review/edit there, and terminate/reopen the app.
3. Change the same card on desktop while the phone is offline. Reconnect and resolve the conflict;
   verify both review histories remain and only the approved content resolution is applied.
4. Expire/revoke the account session during synchronization. Reauthenticate and verify pending
   reviews retry exactly once and media transfers complete.
5. Export a private media backup, restore into a separate clean installation, and verify content,
   attachment bytes, history and replayed schedules.
6. Upgrade from the previous signed version, restart, and repeat offline review and synchronization.
7. Exercise optional conversation retention/deletion, account/provider switching, and failed AI saves;
   verify suggestions never save without approval and review automation pauses while help is open.

Retain logs and observations for each platform. Local regressions and signed build workflows do not
mark this gate passed. Production migration/backup review, signing credentials, real OAuth delivery,
physical-device execution and store distribution remain environment-specific release work.
