# Collection recovery

The collection Files panel provides recovery points, missing-objective-link repair,
and confirmed permanent removal of unused trashed attachments.

Metadata checkpoints are captured before a save, at most once every 30 minutes.
The initial save also creates a checkpoint. Rotation retains twelve recent points,
seven daily points and four weekly points, deduplicating overlapping selections.
Mobile and Electron keep these in their local SQLite database across restarts.
The browser follows the existing privacy policy: its checkpoints live only in the
current tab, so export a workspace backup for durable browser recovery. Erasing
local data clears the checkpoint archive as well.

Restoring content requires confirmation and an unchanged whole-workspace baseline.
It restores earlier card content and study settings while retaining newer cards,
areas, current account ownership and sync cursor, and append-only review history.
Schedules are rebuilt from that history. A checkpoint from another account is
rejected. Restore is a content recovery operation, not a rollback of reviews or
server state. Attachments are not duplicated inside automatic checkpoints; use the
existing full workspace ZIP export for an independent backup including media.

The storage integrity action runs SQLite `quick_check` on mobile and Electron;
the browser has no on-device database to repair. Collection scans separately
report missing/damaged attachments and broken content references. Automatic repair
only removes dangling learning-objective links and corrects the derived review
count. Missing shared notes, templates and media require user repair; corrupted
SQLite files are not rewritten automatically.

Permanent trash cleanup takes the same write lane as workspace/media commits,
reads the latest saved collection inside that lane and protects references in
current content, retained deletions, historical card versions, drafts and retained
automatic checkpoints. It refuses to run without paired write coordination.
Checkpoint parse or storage failures stop cleanup. Deletion failures preserve the
remaining trash markers for retry. Local backup copies outside the app are not
modified. A file protected by a recovery point becomes eligible only after that
point rotates out and all other references disappear.

The recovery regression suite covers rotation, reopening an archive, clear,
restoration with newer cards/history, account ownership, stale restore baselines,
safe repair, and permanent cleanup reference protection. Physical-device storage
corruption and OS-level recovery still require device testing.
