# Study customization

Open **Review settings** in Insights (or workspace settings on mobile) to change defaults,
create named presets, and assign them to subjects. A subject inherits its nearest parent's
preset unless it has its own assignment. Parent groups share introduction budgets across their
descendants; the workspace daily limit remains an upper bound. Parent cycles are rejected.
Creating a preset copies the current workspace policy. Edit and save it to apply changes.

Learning and relearning steps accept up to five increasing whole-minute delays, for example
`1 10`; clear the field to let FSRS choose. Set a maximum review interval, choose new cards before,
after, or mixed with reviews, and order reviews by due date, recall probability, or interval.
Due learning steps always come first. Reduced-load weekdays move future review dates by up to
two days where possible. Set the scheduling time zone used for weekdays (UTC by default).
Existing due dates only change after reviewing or an explicit manual scheduling action.

## Find and practice cards

**Study tools → Extra practice** builds a filtered study collection using a query, order, and
card limit (1–500). Choose one subject or all subjects. Name and save the collection to keep its
query, scope, ordering, limit, and answer behavior. **Rebuild and start collection** refreshes
membership against current cards; deleting a collection never deletes cards.

**Preview without scheduling** leaves due dates, daily budgets and review history unchanged.
**Record answers and reschedule** appends real answers to the cards in their original subjects,
including early reviews and reviews above normal daily limits. Suspended cards are excluded.
Forgotten cards return at the end; session membership remains fixed until rebuilding, even when
an answer changes whether a card matches the original query. Saved searches remain available
separately for reusing just a query.

**Filter scheduled reviews** explicitly applies a query to the ordinary study queue across
subjects. It preserves daily budgets, suspension, burying, and ordinary review logging. A visible
banner lets you clear the filter; cards excluded by a filter are reported separately from cards
that are caught up. The card limit and practice order only affect extra practice.

Library search also understands card queries; ordinary text continues to search the whole library.
Queries with operators search cards. Supported syntax includes:

| Query                                                 | Matches                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `tag:biology` / `tag:exam::*`                         | Exact tags / a tag prefix                                         |
| `deck:"Cell biology"`                                 | Exact subject title (or use the subject ID)                       |
| `front:"ATP synthase"` / `back:respiration`           | Text in a particular card field                                   |
| `is:new`, `is:learning`, `is:relearning`, `is:review` | Scheduling states                                                 |
| `is:due`, `is:suspended`, `is:leech`                  | Due cards or cards needing attention                              |
| `rated:7:again` / `rated:30`                          | Answers within the preceding number of days, optionally by rating |
| `interval:>7`, `stability:>=10`, `difficulty:<8`      | Schedule values; intervals and stability are in days              |
| `lapses:>=3`, `reps:>5`, `due:<=0`                    | Failures, repetitions, or days from now until due                 |
| `(is:new OR rated:7:again) -is:suspended`             | Groups, alternatives, and exclusions                              |

Spaces mean AND; explicit `AND`, `OR`, `NOT`, and `-` exclusions are supported. Use double quotes
for phrases. Unsupported fields and malformed expressions show an error. Queries are bounded to
500 characters, 100 terms, and eight nested groups.

## Manage schedules

**Study tools → Manage scheduling** previews matching cards and supports batches of up to 500.
Set a due date, reset matching cards to new, or assign consecutive starting positions to new cards.
Reset asks for confirmation and restarts memory estimates while preserving all old answers.
Repositioning only accepts new cards. These actions never count as answers or fitting evidence.

## Synchronization and undo

Authenticated workspace sync sends private presets, saved searches, filtered collections, browser
columns, suspensions, ordering and scheduling adjustments to the backend. They are excluded from
published decks and included in private workspace backups and account exports. The Next and ASP.NET
APIs use the same owner-scoped storage and revision checks. Independent settings fields merge;
overlapping edits retain both versions and show a comparison in Study tools. Synced settings remain
active until you choose **Use this device settings** or **Keep synced settings**, then sync again.
Lists such as presets are merged as a field, so simultaneous edits to the same list need a choice.
Changes to settings while sync is running are preserved for the next sync.

**Undo last review** appends a correction without removing the original answer. It restores the
previous schedule, daily introduction budget, sibling-burying state and aggregate statistics.
Corrections and restoration snapshots synchronize between devices. Undo is available for answers
recorded by an updated client with a restoration snapshot; a subsequent manual scheduling action
on that card must be resolved before undo. Each undo targets the latest remaining answer. Private
deck packages preserve corrections and manual adjustments; public copies exclude this history.
Update all clients before sharing these advanced scheduling controls through sync.

## Browse and edit cards

**Study tools → Manage scheduling → Browse cards** searches one subject or all subjects, sorts by
any displayed field, and saves visible columns. Pages contain 50 cards. Expand **Tag hierarchy**
to browse parent tags and their descendants. Select a row to inspect sibling cards and cards with
shared learning objectives.

**Find and replace** previews literal, case-sensitive replacements in Front, Back, or Cloze source.
Front/Back target independent Basic cards; edit shared Basic notes in their source editor. Replacing cloze source validates deletion syntax and regenerates linked siblings once per source, including siblings outside the selected search results. A confirmed batch
must contain at most 500 cards in one subject; invalid content rejects the whole batch. Previous
content is retained in card version history, and scheduling is preserved.

## Read statistics

**Detailed study statistics** can cover all subjects or a subject and its descendants over
7, 30, 90, or 365 days. Charts show daily reviews, recorded time, current due dates, and memory
parameter distributions. Expand each chart to read its values.

First-answer retention counts a card's first answer each local day, including learning answers;
Again is forgotten and Hard/Good/Easy are recalled. Time totals include only recorded durations,
with each new answer capped at 60 seconds; old answers without timing are excluded. Recall and
remembered-card counts are estimates from current FSRS memory state. The forecast shows current
established-card due dates, excludes suspended/new cards, and does not simulate future failures,
new cards, or later reviews. An empty history does not imply zero measured retention or time.

## Plan workload and evaluate fitting

The **Workload simulator** in statistics models repeated answers and failures from current memory
states. Choose the retention target, 1–180 days, new introductions per day, total answers per day
(including learning), and additional new cards. It estimates daily answers, time and end-of-day
backlog, using recorded answer durations or a 15-second default. It is a deterministic seeded
scenario with at most 5000 cards. It uses 24-hour days and the displayed limits, rather than calendar
budgets, sibling burying or reduced-load weekdays. It never changes live schedules or history.
Re-run after changing inputs or study data; one scenario is an estimate, not a guarantee.

Experimental fitting now uses the latest 20% of timestamps as a temporal holdout. Those observations
are excluded from coordinate optimization. At least 100 interday observations, including 20 holdout
and 60 training observations, are required. Log loss, RMSE and calibration buckets show fit quality.
Parameters apply only after a validated improvement, explicit selection and saving. This remains a
bounded local fitter, rather than Anki's optimizer.

Backend setup requires `supabase/migrations/20261019000000_study_sync.sql` before deploying updated
clients, followed by the authored-card and paged-metadata migrations. Metadata transfers use
bounded 5 MB pages rather than a single history document, with at most 200,000 entries per
administrative log/snapshot array; validation failures preserve local data. `supabase/tests/workspace-study.sql`
checks revision conflicts, immutable log retention and account isolation inside a rolled-back
transaction against a database with the migration applied.

## Collection maintenance

Open **Study tools → Manage scheduling → Files** on web/Electron, or the additional study tools on mobile. **Check collection and media** reads attachments sequentially and checks content hashes, MIME signatures, expected sizes, source notes/templates, inline-image references, cloze displays, objectives and empty question/answer text. A scan does not change content.

**Tag cards with missing media** adds `missing-media` to affected cards and source notes, capturing prior card versions. Use the card browser to locate those cards, reattach missing files, then scan again. **Move unused files to recoverable trash** records a reversible local trash entry. Historical card versions, retained deletions, shared source notes and retained editor drafts protect their media. **Restore files from trash** clears these entries. Trash retains bytes until confirmed permanent cleanup. Cleanup rechecks current content, drafts, historical versions and automatic recovery points under the paired write lane before deleting unreferenced files. See [collection recovery](collection-recovery.md).

Imported Anki scheduling is retained as an immutable baseline. Its original review events remain available for statistics, while later schedule replay excludes those events to avoid applying the import twice. Subsequent reviews and undo replay from that baseline; independent copies start fresh.

Deploy `20261020000000_authored_cards_and_audio.sql` after the study-sync migration. It enables browser/native recording MIME types and prevents older sync clients from dropping imported baselines. The SQL regression fixture checks this alongside revision conflicts and owner isolation.

The authored-cards/audio migration also authorizes verified media attached only to shared source notes in published content. `supabase/tests/published-note-media.sql` checks public, token-protected, hidden, owner and unreferenced media access in a rollback transaction.

The study management dialog separates **Browse cards**, **Schedule**, and **Files**. Mobile offers the same choices in its study-management selector. Bulk text editing is under **Find and replace**; table columns and tag filters are under **View options**. Web tab changes retain unfinished search and scheduling inputs until the dialog closes.

Study metadata synchronization now uses revision-fenced keyset pages and delta-only batches,
with a maximum of 5,000 entries and 5 MB per request. Append-only rows preserve corrections,
adjustments, undo snapshots and imported baselines without repeatedly uploading the full history.
Imported baselines are bounded to 50,000 records; other metadata arrays to 200,000 each. Capacity
failures are explicit and never discard old entries. See [collection storage and browser](collection-browser.md)
for the required migration, local SQLite chunk storage, content budgets and search syntax.
