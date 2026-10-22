# Anki interchange

Import `.apkg` or `.colpkg` from the library's **Import Anki deck** action. Review the proposed cards,
attachment counts, review counts and warnings before approving. Imports create a fresh Knowledge Area when there are no matching cards. Matching Anki note GUIDs
and template ordinals update existing content while retaining local card identities, schedules,
suspension and append-only history. Unrelated local cards remain. Matches across multiple areas,
duplicate identities or partial shared-note families are rejected rather than choosing an overwrite.
Import the complete note family when updating shared notes. Incoming history is added only for new
cards, so repeated imports do not duplicate evidence or replace a learner's current progress.
Collection packages import bounded content, not Anki preferences or an entire workspace replacement.

## Supported input

The platform SQLite adapters read legacy `collection.anki2`, uncompressed `collection.anki21`
and normalized v18 collections from `.anki21b` packages. Modern packages use bounded
Zstandard decompression and protobuf decoding for their media manifest and template metadata.

Supported content includes Basic, reversed Basic, numbered and nested Cloze deletions, and custom normal
note types whose templates contain static field substitutions such as `{{English}}`.
`{{FrontSide}}` and nested/inverse conditional field sections are also supported. Imported HTML is reduced to safe text and verified image/audio
attachments. Styling, JavaScript, arbitrary filters and executable template
code are not retained; unsupported template operations are rejected before approval.

Where field names and sizes fit Recall's safe note model, imports preserve shared fields,
note types, template relationships and linked Cloze source text in the note library. Other
representable cards remain usable as independent cards. Review the preview because sanitization
changes visual formatting. Native Anki image-occlusion notes with unrotated rectangles and ellipses are imported as editable
image masks, including grouped targets and hide-one/hide-all modes. Rotations, polygons, text
annotations, custom mask colors and mixed hide modes are rejected explicitly; they are not silently
flattened into text. The original note type's reviewer scripts are never executed.

The package limit is 50 MB, with at most 50,000 imported cards/notes, 250,000 review rows and
100 media assets. Each attachment is limited to 20 MB. Additional bounds cover expanded ZIP
size, SQLite size, protobuf size and expansion ratios. The same bounds apply to collection packages. Parsing remains bounded and in memory.

## Scheduling and history

Supported review queues retain their due date, interval, repetition count and lapse count.
New cards retain their new state even when older review logs exist after an Anki reset.
Timestamp-based learning and relearning queues also retain their due time. Day-based review
dates are interpreted relative to the collection's creation timestamp, rather than import time.
Day-learning queues retain their collection-relative due day. Suspended cards retain their
underlying schedule and are suspended in Recall. Buried cards retain their underlying schedule but
become available again; their session-specific burial is not imported. Filtered-deck cards rebuild
from review history because filtered due positions cannot be interpreted as ordinary due dates.

A preserved schedule is an explicit baseline attached to the card. Its original imported review
IDs identify evidence already represented by that baseline. Later answers replay from the
baseline without counting the imported answers twice. Those original answers remain in the
append-only review history for analytics. Anki cards.data stability, difficulty and last-review time are retained when valid. Older cards
without memory state approximate stability from their interval. Anki scheduler weights, retention,
custom scheduling code and learning-step configuration are not imported.

Only actual scheduled answers become review events. Cram entries and administrative reschedule
rows are excluded, with a count shown in the preview. No missing review history is invented.
When a queue cannot be preserved, Recall rebuilds its schedule from supported imported answers,
or initializes a new card if there are none.

## Exporting to Anki

Choose **Export Anki .apkg** in portable deck transfer. The exporter creates a standard SQLite
collection and media manifest inside a ZIP archive. Browser and Electron use locally bundled
SQL.js; mobile uses Expo SQLite. No remote conversion service is involved.

Exports include shared note fields, safe text templates, reversed cards, linked Cloze content,
tags and verified attachments. Ordinary independent cards become Basic cards. Generated note
GUIDs remain stable for the same source identity. Note-only attachments are included even if no
current card independently references them.

The default export is public content: cards start as new, with no learner scheduling. The
existing **Include private history** switch also enables private scheduling for Anki export,
including due dates, intervals, repetitions, lapses, suspension and FSRS stability/difficulty.
It also exports actual effective answer events with their timestamps, grades and available answer
duration; undone answers are excluded. No synthetic reviews are generated. Original historical
intervals, ease factors and learning/relearning categories are unavailable in Recall events, so
those log fields use zero/unknown intervals and the review category rather than invented values.
Anki requires unique millisecond revlog timestamps: conflicting answer times reject export instead
of silently changing evidence. Treat packages with history enabled as private study data. Scheduler
presets and preferences are not exported.

Use **Export deck ZIP** for a full-fidelity Recall transfer. APKG text templates do not retain
Recall rich formatting, image masks, typed-answer normalization or speech preferences. The
Recall ZIP format retains supported content and, when explicitly selected, its private history.
A full workspace backup remains the recovery format for deleted-card history and the complete
workspace.

## Verification limits

Regression checks build actual SQLite collections and round-trip their APKG archives through
legacy and normalized readers. They cover shared custom notes, reversed templates, scheduling
baselines, genuine imported review evidence, public scheduling reset, unsafe-template rejection
note-only media in APKG, canonical ZIP and portable ZIP, genuine private log export, stable-GUID
reimports, ambiguous-match rejection, larger imports and native occlusion geometry. An optional external-backend regression was also run against Anki 26.9.3: Anki imported the
custom/reversed package with private scheduling, suspension, FSRS memory and genuine answer
history, then exported modern APKG and COLPKG packages that Recall successfully read. This does not establish
acceptance by every Anki release or replace a physical-device/native sharing test.

To repeat the external-backend check without changing project dependencies (Python/pip required):

```sh
python3 -m pip install --target /tmp/recall-anki-python anki==26.9.3
PYTHONPATH=/tmp/recall-anki-python RECALL_TEST_ANKI_BACKEND=1 pnpm --filter @recall/verification test anki-backend.test.ts
```

The ordinary test suite skips that external check unless explicitly enabled.

Protocol references: [Anki card data](https://github.com/ankitects/anki/blob/main/rslib/src/storage/card/data.rs),
[queue semantics](https://github.com/ankitects/anki/blob/main/rslib/src/card/mod.rs), and
[native image-occlusion serialization](https://github.com/ankitects/anki/blob/main/ts/routes/image-occlusion/shapes/to-cloze.ts).
