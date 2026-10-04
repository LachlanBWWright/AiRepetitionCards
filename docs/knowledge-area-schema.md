# Knowledge Area document versions

Portable documents currently use schema version `1.0.0`. The importer also accepts the defined
`0.9.0` shape and migrates it deterministically to `1.0.0` before validating IDs and references.

Version `0.9.0` contains `schemaVersion`, `id`, `title`, nullable `description`, `objectives`, and
`cards`. Each objective has `id`, `title`, nullable `description`, `prerequisiteIds`, and optional
`sourceId`. Each basic card has `id`, `front`, `back`, and `objectiveIds`.

Migration supplies `language: "en"`, empty tutor/quiz/card-generation instructions, basic card kind,
empty card and area tags, `origin: "imported"`, and `licence: null`. It preserves IDs, titles,
descriptions, objectives, and card content. Unknown versions fail with a typed unsupported-version
error; migration never guesses a future shape.

## Cloze cards

Version `1.0.0` supports `kind: "cloze"` cards with `text`, objective IDs, tags, origin, and optional
media references. Deletions use `{{c1::answer}}` or `{{c1::answer::hint}}`; indices run from 1 to 20.
Repeated occurrences of the same index hide together. Other indices remain visible in that study
card. Nested or malformed deletions are rejected.

An optional `deletionIndex` selects one deletion. Without it, import creates a separate study card
for each distinct index, with stable identities and independent schedules. Export includes the
selected index and original text so subsequent import does not expand the same variants again.
The combined expanded area is limited to 500 study cards. Private workspace backups retain the
rendered question/answer, Cloze source content, and schedules; portable documents exclude learner
schedules and review history.

Optional area/card/objective `sourceId` fields retain stable source identities across forks. The
comparison use case normalizes deletion variants and objective references before comparing content.

## CSV and TSV tags

Delimited exports include readable `front`, `back`, `objective` and `tags` columns plus `tags_json`, a JSON array inside the normally quoted CSV/TSV cell. Recall imports prefer `tags_json` when present, preserving literal pipes, semicolons, quotes, commas and newlines inside individual tags. An empty JSON cell means no tags; a malformed array or non-string tag produces `invalid-tag-encoding` before acceptance. Empty strings and longer imported tags remain valid, matching canonical content schemas; the existing field, file and row bounds still apply.

Older files containing only `tags` or `tag` still use pipe/semicolon-separated lists. Their literal bracket-prefixed tags retain their existing meaning. Other readers can use the readable column; preserving exact tag text requires the JSON column. Delimited files carry Basic question/answer content and objective labels; native JSON/ZIP remains the format for Cloze structure, media and full content metadata.

CSV/TSV imports ignore wholly blank or whitespace-only rows. Every remaining card row must contain both a nonblank question and answer. An incomplete row fails the entire import with `missing-front-back` before new identities are generated; valid rows are not partially accepted while other content is silently discarded.
