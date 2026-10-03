# Recall Mobile

The Expo client shares the domain, Effect application use cases, scheduler, local-store port, and design tokens with the web workspace. It starts with a small sample Knowledge Area, stores the complete workspace snapshot in SQLite, and records FSRS reviews while offline.

## Run on a device or simulator

From the repository root:

```bash
pnpm install
pnpm dev:mobile
```

Use Expo Go for SDK 57, or launch an installed development build with `pnpm --filter mobile android` or `pnpm --filter mobile ios`. An iOS simulator build requires macOS; a physical iOS device can use Expo Go.

The SQLite database is the native source of truth for workspace snapshots and media. Email-link sessions are stored with SecureStore; bearer-token sync pushes content and reviews and pulls changes. Knowledge Areas import from validated JSON or media ZIP packages and export through the native share sheet. Imported areas receive fresh IDs, schedules, and review history. Use **Export private backup** to share a complete workspace archive with its review history, schedules, and attachments. **Restore private backup** validates the archive, asks before replacing the local workspace, and rolls back newly written media if the workspace write fails.

## Email sign-in

Set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_RECALL_API_URL` (the deployed Recall web origin) in the Expo environment, then restart Expo. Add the native redirect `recall://auth/confirm` to the Supabase project's allowed redirect URLs and configure its email template to send the `token_hash` and `type` query values through to the redirect. The session is persisted with Expo SecureStore. The mobile client can push Knowledge Areas and pending reviews, then pull remote changes with bearer access tokens; web browser sessions continue to use secure cookies.
