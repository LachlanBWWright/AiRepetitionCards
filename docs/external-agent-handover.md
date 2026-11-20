# External AI handovers

Choose **Use external AI** in a deck's library, Tutor, or Improve view. This works
without a connected AI account, an API key, or a Recall managed-AI grant. Web and
Electron use the same dialog. Mobile uses an expandable panel with the same
shared workflow and validation.

## Discuss first, propose changes later

1. Choose **Improve this deck**, **Explain an error or mistake**, **Teach this topic**,
   **Quiz me**, **Check accuracy**, or **Custom request**. Add your goal, question,
   code/error, or the answer you want explained.
2. Include all cards in the current deck, or search and select individual cards (up to 100 matches are displayed at once). Recent
   conversation (the last 20 messages in the current Tutor or Improve flow) and
   review history (the last 20 ratings for selected cards) are optional and off
   by default. The library entry has no conversation to export.
3. Select **Prepare handover**. Inspect the generated JSON, then **Copy handover**
   or save it as a JSON file. Mobile can also share the file through its OS sheet.
   Paste or attach it in your external assistant. Nothing is sent automatically.
4. Discuss the subject there. Task prompts tell the assistant to converse first;
   explanations and quizzes do not need an import. When ready, say **prepare
   changes**. The package supplies the exact response schema and a template.
5. Paste the response into **Review AI changes**, or open its JSON file. Select
   **Validate and preview**, expand each change to compare before and after,
   then **Apply approved changes**. Deletions require a separate approval toggle.

Exports contain selected card text, tags, explanations and deck objectives. They
exclude attachments, account credentials, schedules, device identifiers and
unselected conversation/history. Review records contain timestamps and ratings;
they do not contain a learner's answer, so provide an answer explicitly when
asking an agent to explain a mistake. Imported learning content and conversation
excerpts are marked as untrusted data in the prompt.

## Change format

`recall-agent-handover` version 1 packages contain a `handoverId`, deck revision
markers, context, task instructions, `proposalTemplate`, and `responseSchema`.
Responses use `recall-agent-changes` version 1 and copy `handoverId` and `decks`
from the handover. Each proposal contains at most 100 ordered operations:

- `create-deck`: unique `key`, `title`, `color`.
- `update-deck`: exported `deckId`, complete `title` and `color`.
- `delete-deck`: exported `deckId`.
- `create-card`: unique `key`, `deckId`, `front`, `back`, `explanation`, `tags`.
- `update-card`: exported `deckId` and `cardId`, complete `front`, `back`,
  `explanation`, `tags`.
- `delete-card`: exported `deckId` and `cardId`.

Creation keys are temporary references, not database IDs. A new deck's key may
be used as `deckId` by subsequent card creations. Recall derives stable fresh
identities from the handover and keys, preventing accidental replay of the same
creations. Existing identities, card schedules and review evidence are preserved
when editing; new cards start with fresh schedules. Deletions use the ordinary
recoverable deletion pipeline and preserve append-only review history.

The first version creates basic text cards and edits only basic cards without
note linkage, cloze or image occlusion. Existing attachments, objectives and
presentation settings are retained on edits. Complex card edits must use Recall's
card editor; the importer rejects them explicitly. Discussion of those cards is
still possible. It does not accept executable tools, arbitrary application
commands, scheduling changes, or review-history writes. Unknown fields and
unsupported operations are errors. A single enclosing `json` Markdown code fence
is accepted; prose surrounding a proposal is not.

## Revisions and saves

Deck revisions cover authored content, including unselected cards, and exclude
derived card schedules. Editing deck content after export invalidates the
proposal; new reviews alone do not. The application checks revisions again
inside the serialized persistence operation, not just at preview time. A failed
operation rejects the whole batch before persistence. Import never treats
missing cards as deletions, and rejects duplicate edits and combined deck
deletion/edit operations.

The shared application implementation supports multiple deck baselines. The
initial UI exports the current deck; switch decks to prepare another handover.
JSON input and output are limited to 2 MB. To reduce a large export, select fewer
cards. Imported proposal state lives only in the open panel; closing it discards
the unsaved preview, so keep a copy of the agent's response if needed.

Mobile requires rebuilding after installing `expo-clipboard`. Native file
sharing and clipboard behavior still require verification on an actual iOS or
Android device; the shared/native view can also be exercised in Storybook.

## Verification

Application checks: `pnpm test agent-handover.test.ts agent-changes.test.ts`.
Browser checks: `pnpm test:e2e agent-handover.test.mjs` (web and native-rendered
round trips, stale proposals, deletion approval, clipboard and JSON files).
