# Source layout

Related source files live together by feature or responsibility. Public package
entry points keep their existing exports; imports inside a feature point directly
to the module they need.

## Application operations

`packages/application/src/index.ts` is the public facade. Its exports are grouped
into these folders, each with a small public `index.ts`:

```text
packages/application/src/
  account/
  activities/
  authoring/
  http/
  interchange/
    anki/
    portable/
  materials/
  notebook/
  publishing/
  review/
  subjects/
  tutor/
    chat/
    proposals/
    transport/
    workflow/
  usage/
  workspace/
    media/
    sync/
```

For example, the local tutor adapter is now
`packages/application/src/tutor/workflow/local-tutor-api.ts`. The conversation
operations live in `tutor/chat/`, and notebook storage/state operations live in
`notebook/`.

## Shared React workflows

`packages/react` (`@recall/react`) owns React state and lifecycle behavior shared by web,
Electron, and mobile. Its `activities/`, `decks/`, `workspace/`, and `study/` folders contain
activity authoring/attempts, deck updates, library-note persistence, filtered practice,
preset editing, manual scheduling, command saving, and review timing. It imports no browser,
Expo, Next.js, or React Native services. Platform boundaries inject storage, media gateways,
identity generation, clocks, and save operations. App hook entry points remain stable re-exports.

Pure command preparation, settings drafts, preset/search updates, and queue-aware subject
summaries remain in `packages/application`. It has no React dependency. Platform renderers
use their existing controls. Native persistence supplies its status/location through the
same store interface; Metro and Vite resolve shared hooks against the renderer's React copy.

## Web

The dashboard remains under `apps/web/src/features/dashboard/`. Its entry component
and props stay at the root; navigation, state, layout, subjects, library, review,
storage, transfers and dialogs have their own folders. Authoring is further grouped
into actions, cards, drafts and subjects.

`apps/web/src/components/tutor/` groups chat, connection, research, assistance,
proposals, materials, notebook and practice UI. Notebook components have focused
practice, materials and proposals subfolders. Practice has a separate quiz folder.

Knowledge components are grouped into library, settings, activities, overview and
history. The library separates table rendering, bulk actions, duplicates and
recovery. Publishing separates sharing, releases, updates and moderation; release
forms and workflows live together in their respective subfolders.

Next.js route entry points remain under `apps/web/src/app/`. Stories stay beside
the components they describe.

## Mobile and desktop

Mobile components live under account, activities, authoring, library, media,
publishing, review, sharing, tutor and workspace folders. Authoring separates
editor, library, drafts, settings, workflows and section composition. Tutor follows
the same chat, notebook, materials, assistance and practice grouping as web.

Mobile storage adapters are grouped into auth, AI, interchange, materials, media,
publishing and workspace. App composition separates state, actions, subjects,
review and transfers.

Desktop main-process code separates ChatGPT integration, IPC, services and
security. ChatGPT integration further separates auth, transport, research and
usage. `apps/desktop/src/main/index.ts` remains the Electron entry point.

Supabase adapters separate account, publishing, tutor and workspace operations.
The existing package subpath exports resolve to their new locations.

## Verification

`packages/verification/tests/` groups tests by responsibility. Local integration
fixtures are grouped into browser, ChatGPT, desktop and workspace folders.

The suite runner discovers nested tests. Existing basename selections such as
`pnpm --filter @recall/verification test scheduler.test.ts` still work. A nested
selection such as `review/scheduler.test.ts` also works. Ambiguous basenames must
be specified with their folder. Test suites were not executed for this relocation.

When adding files, use the existing feature folder. Create a focused subfolder
when a feature contains multiple distinct workflows, rather than extending a flat
list with more filename prefixes. Internal modules should not import their own
package facade merely to reach a neighboring file.
