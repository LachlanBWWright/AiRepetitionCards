# Study workspace design

Recall is a working environment for writing and reviewing learning material. The card's
question and answer are the main visual content. Controls should make that content easy to
shape, inspect and save.

## Palette and type

Use the existing shared palette: Paper `#0a1020`, Surface `#111a2c`, Ink `#e6edf8`,
Muted `#98a8c0`, Blue `#60a5fa`, and Violet `#c4b5fd`. Blue identifies active controls and
focus. Extra color should communicate a study state or a problem, rather than decorate a form.

Keep Geist for web controls and the established native system typography. Web generated-card
previews use Georgia at 20px for the question and 18px for the answer, with generous line height.
This distinguishes reading a card from editing its fields. Body copy and controls stay at
14–16px; supporting text uses 12px. Headings use sentence case and modest weight.

## Layout choice

The original form placed everything in one column:

```text
Fields
Formatting instructions
Attachments
Template configuration
Collapsed previews
Save
```

The revised layout keeps content in one place until a preview is requested:

```text
Note type                         Saved note
Fields and compact toolbar
Attachments and tags
Preview cards (collapsed)
Advanced template settings
Save note    Save and add another
```

The first design pass showed source fields beside live cards. Review found this repeated basic
question/answer content unnecessarily, especially alongside the Storybook fixture's saved-card
listing. Previews are now opt-in, the fixture listing is removed, and each note editor has one
preview control. Introductory copy and empty-state slogans were removed as well.

Labels and content remain left aligned. Input focus is shown on the whole field container.
Advanced controls use the shared accordion and dropdown primitives. A dashboard of matching
statistic cards was rejected because it gives settings the same visual importance as the actual
learning material.

Study management separates Browse cards, Schedule, and Files into shared accessible tabs on
web/Electron and the existing native selection control on mobile. Switching web tabs keeps
unfinished searches and scheduling inputs. Card tables use readable dates and named columns;
view options and bulk replacement remain available without occupying the initial view.

## Restraint and verification

Use borders to group an editable field or distinguish question from answer. Avoid decorative
badges, gradients, stacked explanatory paragraphs and automatic entrance animation. Formatting
icons have accessible names; file pickers and menus use the project's existing primitives.

Review empty and populated notes, a narrow viewport, tab navigation, scan results, save actions,
and expanded image-coordinate controls. Native visual appearance also needs device review;
React Native rendered inside Storybook does not reproduce every platform style.
