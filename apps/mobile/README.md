# Recall Mobile

The Expo client shares the domain, Effect application use cases, scheduler, local-store port, and design tokens with the web workspace. It starts with a small sample Knowledge Area, stores the complete workspace snapshot in SQLite, and records FSRS reviews while offline.

Bottom navigation separates Today, Library, Tutor, Sharing and Account. Switching tabs preserves open forms and pending actions; Library, Tutor and Sharing include a learning-area selector. Forms scroll above the keyboard instead of sharing fixed screen space with the study card.

## Run on a device or simulator

From the repository root:

```bash
pnpm install
pnpm dev:mobile
```

No credentials, `.env` file, Supabase setup or running web server are required for local use. Create and edit cards, study, import/export and keep private backups with SQLite on the device. Hosted tutoring, account sync and cloud sharing require optional service configuration.

Use Expo Go for SDK 57, or launch an installed development build with `pnpm --filter mobile android` or `pnpm --filter mobile ios`. An iOS simulator build requires macOS; a physical iOS device can use Expo Go.

The SQLite database is the native source of truth for workspace snapshots and media. Email-link sessions are stored with SecureStore; bearer-token sync pushes content and reviews and pulls changes. Knowledge Areas import from validated JSON or media ZIP packages and export through the native share sheet. Imported areas receive fresh IDs, schedules, and review history. Use **Export private backup** to share a complete workspace archive with its review history, schedules, and attachments. **Restore private backup** validates the archive, asks before replacing the local workspace, and rolls back newly written media if the workspace write fails.

While a review is saving, rating, area selection and local reset controls are unavailable. Rapid repeat taps record one review operation. A storage failure keeps the review in the current session and shows an explicit notice; restart persistence still requires storage to recover.

CSV/TSV import previews the card and objective counts before adding a separate area through the same durable save lane. Headers support front/question/prompt, back/answer/response, tags and objective labels; headerless files use the first two columns. Exports use the native share sheet and include an authoritative `tags_json` column to preserve exact tag text. These formats omit attachments, schedules and review history; use area packages or private backups for those.

The existing tutor quiz action targets the strongest combined review/coverage gap and accumulated tutor evidence, with stable objective ordering for ties. Learners can choose another displayed gap explicitly. Up to 100 validated observations remain available across subsequent questions and evaluations; uncertain feedback does not create a gap.

## Offline authoring

**Manage your learning** creates, renames, recolors and deletes learning areas, including when the library is empty. Search all cards by question, answer, objective or tag, then create or edit Basic and Cloze cards. Cards support objective links, tags and up to 20 image/audio attachments. **Add image or audio** verifies file type, size and content before staging it in the draft; saving commits card content and attachment bytes together. Failed saves preserve the draft, and cancelling discards newly selected files. Existing attachments are preserved unless explicitly removed.

Area settings edit descriptions, language, licensing, attribution, AI instructions, objectives and prerequisite links. Shared application commands validate each change against the latest workspace before SQLite commits it. Editing captures an authored-content baseline, so stale drafts cannot overwrite newer edits; review scheduling changes do not invalidate drafts. Failed writes retain the open form. Area and card deletion ask for explicit confirmation and preserve append-only review history in private backups.

## Private practice preferences and history

Review settings save a private FSRS target retention between 70% and 97% (default 90%). Changes affect future reviews; they do not rebuild existing schedules or rewrite history, and shared exports omit them. The card library combines search and learning-objective filters.

Your practice shows today's and the last seven days' recorded review counts, rating totals and the latest 20 reviews. Deleted cards and areas retain their review evidence. Older aggregate totals without individual events are disclosed separately. Tutor feedback exposes model-reported confidence and qualifies uncertain assessments; confidence is not a probability of mastery. Completed quiz answers keep their feedback visible.

## Optional cloud sign-in and sync

For cloud features, copy `.env.example` to `.env` and set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_RECALL_API_URL`. Use the deployed Recall web origin outside local development. For a physical device, replace `localhost` and `127.0.0.1` with the development machine's LAN address, and make sure the web API and local Supabase are reachable from the device; restart Expo after changing environment values. Add the native redirect `recall://auth/confirm` to the Supabase project's allowed redirect URLs and configure its email template to send the `token_hash` and `type` query values through to the redirect. The session is persisted with Expo SecureStore. The mobile client can push Knowledge Areas and pending reviews, then pull remote changes with bearer access tokens; web browser sessions continue to use secure cookies.

## Styling foundation

NativeWind 4.2.7 uses the mobile-local Tailwind 3.4.17 config, Expo Babel preset and Metro CSS integration. Utilities include `bg-recall-paper`, `text-recall-ink`, `p-recall-md` and `rounded-recall-card`, sourced from the same canonical design tokens as web. Tailwind scans `App.tsx`, native components and `packages/ui-native/src`; keep utility names statically discoverable.

After configuration changes, restart Metro with `pnpm --filter mobile start --clear`. Changes to Reanimated, Worklets or safe-area-context also require rebuilding an existing native development client. Shared native primitives keep their StyleSheet styles for portable Storybook previews. See [ADR 0010](../../docs/adr/0010-nativewind-styling.md) for the pinned versions and remaining device validation.

## Native release artifacts

The bundle identifier and Android package are `com.recall.study`. EAS configuration provides internal preview builds and production store artifacts, with a manual GitHub build workflow and fail-closed credential preflight. Supply your actual Expo account owner, project UUID, access token and remote signing credentials before requesting a build. See [native release setup](../../docs/mobile-release.md) for commands, environment configuration and external release requirements. `pnpm build:mobile` continues to export JavaScript/assets; signed native builds use the explicit release scripts.
