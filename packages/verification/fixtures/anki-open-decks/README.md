# Openly licensed real-world Anki fixtures

These five packages are unmodified downloads used for offline importer regression tests.
Python, Bicep and OO Design also supply the attributed learner starter decks. `manifest.json` pins the source commit, download
URL, SHA-256, actual database format, source counts and expected import outcome. Upstream
README counts can differ from the packaged database; the manifest records the latter.

## Attribution

- **OO Design**, **System Design Exercises**, **System Design**: Copyright 2017 Donne Martin,
  [System Design Primer](https://github.com/donnemartin/system-design-primer),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Original license notice: `system-design-primer/LICENSE.txt`.
- **Python**, **Bicep**: Copyright 2026 tltaylor1,
  [Anki decks](https://github.com/tltaylor1/anki-decks),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Original license notice: `tltaylor1/LICENSE.txt`.

No package content has been modified. Import-time HTML sanitization changes the resulting
Recall proposal; it does not rewrite these source packages. Remote image links in the
System Design packages are not fetched, redistributed or treated as licensed fixtures.

## Results

Run `pnpm test anki-open-decks.test.ts` from the repository root. No network is required.

- OO Design: 6 notes/cards imported; HTML sanitized in 12 fields; reimport retains identities
  and schedules without duplicate cards or history.
- Python: 127 notes/cards imported from `collection.anki21`, rather than its one-card
  legacy compatibility database; 5 fields sanitized; reimport is stable.
- Bicep: 50 notes/cards imported from `collection.anki21`; reimport is stable.
- System Design Exercises: 8 notes/cards imported with 20 remote media references replaced
  by visible placeholders and an approval warning. No remote content is fetched.
- System Design: 42 notes/cards imported with 25 remote media references replaced
  by visible placeholders and an approval warning. Reimport remains stable.

These checks exercise the shared application importer and actual Electron SQLite adapter,
then apply/reapply proposals to an isolated in-memory workspace. They do not automate file
selection, approval UI, browser WASM SQLite or native Expo SQLite. Those adapters still need
the same real packages exercised on their respective runtimes. These five packages do not
cover bundled audio/images, cloze or Zstandard `.anki21b`; existing synthetic tests cover
those cases, but additional real-world fixtures would improve coverage.
