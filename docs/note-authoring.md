# Shared notes and formatted card text

The web and Electron Add card dialog includes **Use shared notes and templates**. Mobile's authoring panel includes **Create or edit shared notes**. Choose Basic, Basic and reversed, or Cloze. A note generates related cards; editing a generated card opens its shared source note. Existing card identities retain their review schedules and history when their template/deletion identity is unchanged.

**Customize fields and templates** changes the selected note type. Fields use plain names such as `Front`, `Back`, or `Example`. Templates substitute `{{Field name}}` and support nested conditional sections: `{{#Example}}...{{/Example}}` renders when Example is populated, and `{{^Example}}...{{/Example}}` renders when it is empty. They do not evaluate HTML, scripts, or arbitrary template expressions. A type can generate several cards. Clone a type to make an independent type and note. Changes affecting other notes require confirmation and regenerate their cards atomically. Removing a template retires its generated siblings through the normal recoverable deletion workflow.

Mark a field **Keep ... when adding another note** to retain its value after **Save and add another**. Tags and learning objectives are also retained. These retained values belong to the current editing session; the sticky-field setting is part of the note type. Each template can configure typed answers, pronunciation and reusable appearance separately. Appearance provides fixed typeface, size, alignment and line-spacing choices; arbitrary CSS is not supported.

Card and note text supports `**bold**`, `*italic*`, inline backtick code, `# headings`, `> quotations`, `- lists`, and `1. numbered lists`. Formatting buttons wrap selected text or insert at the caret; list actions apply to the selected complete lines. Preview displays the result only when opened. Raw HTML remains literal text. Review rendering uses the same parser on web, Electron, and mobile.

Equations use inline `$...$` or `\(...\)` and display `$$...$$` or `\[...\]` delimiters. Display equations may span lines. A shared offline MathJax SVG adapter renders mathematical TeX, including AMS notation, fractions, roots, integrals and matrices. HTML, URL commands, extension loading and remote fonts are disabled; local macros are isolated per equation and expansion is bounded. Invalid or unsupported equations retain readable source. See [Rich content](rich-content.md) for details.

Inline images use `![Description](media:ATTACHMENT_ID)`. The ordinary card editor offers insertion controls for existing image attachments; a newly attached web image becomes available after saving and reopening. Shared notes can attach new images/audio directly and reuse images already attached to cards in their subject. Image references resolve only through the host's attached-media map, so card text cannot fetch arbitrary remote images.

Shared note edits are retained automatically through the existing library-notes store, including staged attachment bytes. Reopening the same new-note editor or linked note restores its draft and original content baseline; saves reject intervening content changes instead of overwriting them. Draft-only media remains protected during collection maintenance. Drafts are private local authoring state; saving a note commits its cards to the ordinary content synchronization flow. Ordinary cloze creation also creates a shared source note and generates all deletion siblings; editing a legacy cloze adopts matching source siblings while retaining their identities and history.

Published forks preserve source notes, templates, presentation settings and note-owned media. When receiving deck updates, related cards from a changed source note must be accepted together. A note-type change can affect several notes; partial selections that would separate generated cards from their source are rejected. Local source changes require explicit conflict confirmation. Local-only notes and types remain available. Changes to unused notes or types with no generated cards require importing a fresh copy; the update workflow reports this explicitly.

Open **Preview cards** to inspect generated cards. Previews stay collapsed while writing. Formatting controls stay beside the field they affect; the image menu inserts an actual attached image. Advanced fields and template controls remain under **Customize fields and templates**.

## Changing fields and note types

Open a saved note and expand **Customize fields and templates** to rename, reorder or remove
fields. Renaming updates field references in templates and migrates every note using that type;
reordering changes editor order. Removing a referenced field requires updating its templates before
saving.

**Change note type** maps destination fields to source fields and destination templates to existing
card templates. A mapped card retains its identity, schedule and append-only review history when
its cloze deletion index also matches. Choose **New card** to start a new schedule. Mapping a source
card to multiple destination cards is rejected. Other notes already using the destination type stay
unchanged.

Before saving, the editor lists nonempty field values that will be discarded and cards that will
move to recoverable trash. These removals require explicit confirmation. Source mappings are kept
with unfinished drafts. Type conversion preserves the source note identity, tags, objectives and
attachments; it does not rewrite review events.

## Template subjects and linked source notes

Each template's **Card subject** selects where its generated cards are studied. The original
subject owns the canonical note; other subjects carry self-contained snapshots of its fields,
type, objectives and attachments. Opening a destination card edits the original source, and saving
updates its siblings across subjects atomically in local storage. Publishing a destination subject
exports an independent note without private source links or subject-routing settings.

Reviewed and unreviewed cards can change subjects while keeping their identities, schedules and
append-only review history. Historical events retain their original subject as provenance;
scheduling, undo and study statistics resolve the card's current placement. Deleting the original
subject leaves destination cards as independent local notes.

Content synchronization uploads connected source/destination subjects, including link removals
and card moves, in one revision-checked database transaction. A stale member rejects the entire
family. An oversized family fails before media upload instead of being split into partial writes.
Older clients cannot bypass the server's whole-family validation.

Previously divergent snapshots and independent destination edits still require an explicit source
editor decision. Collection checks report these conflicts and show the conflicting field values.
Its local content baseline covers all subjects, so concurrent destination edits reject a stale save
instead of being overwritten.
