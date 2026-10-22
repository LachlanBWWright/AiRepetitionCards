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

Math SVG is drawn using the established light card-ink color. Device fonts differ between
platforms. Native equation layout and text selection still need physical-device acceptance.
