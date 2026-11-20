# Rich content and reusable templates

Formatting actions apply to the selected text or insert at the caret on web, Electron and
mobile. Bulleted and numbered list actions apply to the selected complete lines. Attached
images insert at the current selection. Formatting respects the editor's length limit.

The format remains plain text: `**bold**`, `*emphasis*`, backtick code, headings, quotes and
lists. HTML and JavaScript remain text and are never executed.

## Mathematics

Use `$...$` or `\(...\)` for inline TeX. Use `$$...$$` or `\[...\]` for display equations;
display equations may span several lines. Fractions, roots, superscripts, integrals, matrices
and AMS notation render as offline SVG on both clients using one infrastructure adapter.
No network fonts or remote scripts are loaded. Unsupported or invalid equations retain their
editable source instead of disappearing.

The adapter enables only MathJax's base, AMS and local macro-definition packages. HTML, URL
commands, extension loading and automatic package loading are disabled. Every equation gets
a fresh parser; macro definitions cannot affect another card. Input and macro expansion are
bounded. This is mathematical TeX, rather than a general LaTeX document compiler.

The **Equation** composer offers inline/display layouts, reusable examples, a live preview,
and syntax feedback before insertion. It respects the card field's character limit. Code spans
and fenced code blocks protect literal math syntax; currency and escaped delimiters stay text.
See [card content](card-content.md) for notation and the separate answer/explanation workflow.

## Conditional sections

Templates support nested positive and inverse sections:

```text
{{Front}}
{{#Example}}Example: {{Example}}{{/Example}}
{{^Example}}No example supplied.{{/Example}}
```

Positive sections render when a field contains non-whitespace text; inverse sections render
when it is empty. Section names must match existing fields, closing sections must match their
opening sections, and nesting is limited to 20 levels. Inserted field values are never parsed
again as templates. A card with an empty question or answer is omitted as before.

## Appearance

Each card or reusable note template can specify typeface, text size, alignment and line spacing
under **Appearance, answer and pronunciation**. Template changes regenerate linked cards using
the existing confirmation and history-preservation workflow. Appearance is portable through
private sync, backups and published decks and is validated at both client and backend boundaries.
The style vocabulary contains fixed choices; arbitrary CSS, HTML and scripts are not supported.

Math SVG is drawn using the established light card-ink color. System serif and native monospace fonts differ between
platforms. Native equation layout and text selection still need physical-device acceptance.

## Field appearance and layout presets

The shared Appearance editor on web, Electron and mobile offers comfortable reading, large
centered, compact code and right-to-left reading presets. Choosing a preset copies its
validated values, which remain independently editable and are saved with the card or template.
Question, answer and explanation can each override the card appearance; disabling an override
returns that field to the card default. Alignment includes right alignment, and reading
direction offers automatic, left-to-right and right-to-left. Older cards retain their existing
appearance and automatic direction. Image size choices bound inline images to 160, 280 or
480 pixels while retaining aspect ratio and fitting the available width.

Geist Sans is bundled locally for web/Electron and native card text. Geist Mono is bundled
for web/Electron; native monospace and serif choices use platform fonts. Font licenses ship
with the assets. There are no remote font requests or arbitrary user font URLs. The fixed
font vocabulary deliberately does not import arbitrary Anki font files. Native text falls
back to a system font while its bundled font loads. Per-field choices survive private sync,
portable backup and published deck normalization, including reusable note templates.
