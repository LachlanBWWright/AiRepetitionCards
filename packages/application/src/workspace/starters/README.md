# Licensed starter decks

New web, Electron and native workspaces start with Python (127 cards), Bicep (50 cards),
and OO Design (6 cards). Every card starts new, due at workspace creation, without imported
review history. Existing saved workspaces, including deliberately empty ones, are preserved.
Mock Storybook fixtures remain independent of learner defaults. No network or SQLite runtime
is needed to create the starter workspace.

Python and Bicep are Copyright 2026 tltaylor1, from
[anki-decks](https://github.com/tltaylor1/anki-decks), revision
`46c30a3c6ff5565edd7067bb344a0e8f50209f3d`.
OO Design is Copyright 2017 Donne Martin, from
[System Design Primer](https://github.com/donnemartin/system-design-primer), revision
`ae9bbd7b02d90b9866215de185217d33f39ab733`.
All three are licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Original license notices and package hashes are retained in
`packages/verification/fixtures/anki-open-decks/`.

The data files contain the complete generated card text and Anki source identities, converted
by Recall's validated importer. HTML styling was removed; schedules, personal history and
Anki preferences were not copied. License, attribution, source link and modification notices
are also stored on each learner-facing deck. System Design and Exercises are excluded from
defaults because their remote diagrams are not bundled.

To regenerate after intentionally updating the pinned fixtures:

```sh
node scripts/run-tooling.mjs node packages/verification/scripts/generate-starter-decks.mjs
pnpm --filter web exec prettier --write ../../packages/application/src/workspace/starters/data
pnpm test anki-open-decks.test.ts starter-workspace.test.ts
```

The real-deck tests compare all starter card text/source identities against the original
packages, so regeneration drift cannot silently change the examples.
