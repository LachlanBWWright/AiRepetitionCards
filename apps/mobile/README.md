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

Pull requests and pushes to `main` also build an Android APK and an Apple Silicon iOS simulator app through `mobile-local-packages.yml`. These builds require no Expo account or Recall server and embed their JavaScript/assets so they start without Metro. Optional public cloud settings come from repository variables; leaving them unset disables those services. The same app keeps local study available when cloud settings are configured and the network is unavailable. Download the workflow artifacts: install the Android APK on a compatible device, or extract the iOS archive and install `Recall.app` in an iOS simulator. Android uses a development signing key; the simulator archive cannot be installed on a physical iPhone. CI verifies that the APK includes its JavaScript bundle and both arm64/x86_64 native libraries, and that the simulator app includes its bundle and arm64 executable before uploading. The jobs use Node 22.13 or newer within Node 22, Java 17 for Android, and Xcode 26.6 on macOS 26 for iOS. Generated `android/` and `ios/` projects are disposable build output and are not committed.

The bundle identifier and Android package are `com.recall.study`. EAS configuration provides internal preview builds and production store artifacts, with a manual GitHub build workflow and fail-closed credential preflight. Supply your actual Expo account owner, project UUID, access token and remote signing credentials before requesting a build. Local-only signed builds can leave all three cloud client variables blank; enabling cloud features requires the complete API/Supabase configuration. See [native release setup](../../docs/mobile-release.md) for commands, environment configuration and external release requirements. `pnpm build:mobile` continues to export JavaScript/assets; signed native builds use the explicit release scripts.

### Private knowledge notebooks

The Tutor screen includes a local knowledge notebook for each learning area: concept coverage, evidence from answers and reviews, confidence, possible misconceptions, and editable card proposals. Start or resume investigations with question, AI request and time budgets; add concepts manually or approve suggested concepts. Notebook data and explicit answer drafts are saved on this device. Adaptive questions and evaluation require the optional configured tutor service; existing notebooks remain readable offline. Approved cards are saved locally before provider acknowledgement, which can be retried separately. Failed AI attempts retain their request charge.

Notebooks are separate from workspace ZIP backups and cloud sync. Use **Export notebook JSON** to share a private copy containing learning history. Clearing one notebook preserves cards and reviews. Device reset or account data deletion removes every notebook, including records belonging to deleted areas.

## Study materials

The Tutor notebook supports pasted text and local TXT, Markdown, DOCX and text-based
PDF files up to 16 MiB. Review/correct extraction and select passages before generation.
Extracted text is stored on the device and included in notebook JSON exports; original
files are not retained. **Choose scanned PDF or image (OCR)** recognizes PNG/JPEG notes
and scanned PDFs locally, with a user-selected range of up to 20 PDF pages per import.
The iOS implementation uses Apple Vision/PDFKit; Android bundles the ML Kit Latin text
model and uses PdfRenderer, so recognition needs no server or model download. OCR targets
English and Latin script. Review spelling, reading order, code and formulas; edit saved
passages before generating cards. Temporary file copies are deleted after extraction.
OCR requires a rebuilt native application and is unavailable in Expo Go. Physical-device
OCR/PDF execution still needs runtime validation.

Choose a study goal, depth and card count. Each proposed card consumes one admitted AI
request; pause stops the batch after the current request. AI requires an eligible
configured provider and network access. Approve cards explicitly after reviewing their
source quotes and page references, then study them offline with spaced repetition.
