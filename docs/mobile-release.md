# Native release builds

The mobile project uses `com.recall.study` for both the iOS bundle identifier and Android application ID. `recall://auth/confirm` remains the authentication callback scheme. These identifiers are stable; associate the corresponding store records and signing credentials with them before creating release artifacts.

## Build profiles

| Profile      | Distribution | Android            | iOS                        | Environment      |
| ------------ | ------------ | ------------------ | -------------------------- | ---------------- |
| `preview`    | Internal     | Installable APK    | Signed ad hoc device build | EAS `preview`    |
| `production` | Store        | Android App Bundle | Signed store archive       | EAS `production` |

`eas.json` uses Expo-managed remote signing credentials and remote version numbers. Production builds increment the native version automatically. Preview builds have no development client dependency. The existing `pnpm build:mobile` command exports JavaScript/assets; it does not produce a signed APK, AAB or iOS archive. These settings follow Expo's [build profile](https://docs.expo.dev/build/eas-json/) and [version management](https://docs.expo.dev/build-reference/app-versions/) documentation.

## Provision the external account and credentials

1. Create or select the real Expo project in your Expo account or organization. Record its project UUID as `EAS_PROJECT_ID` and owning username/organization as `EXPO_ACCOUNT_OWNER`. The repository deliberately contains no fabricated project ID.
2. Create an Expo access token authorized for that project. Supply it as `EXPO_TOKEN` in your local shell or CI secret manager. The dynamic app config validates project linkage and includes only the public project ID and owner. Offline development remains available when linkage is absent.
3. Configure remote Android signing credentials and the Apple distribution certificate/provisioning profiles for `com.recall.study` through Expo. Register physical iOS devices before internal builds. Non-interactive builds cannot finish first-time credential setup or device enrollment. Follow [managed signing](https://docs.expo.dev/app-signing/managed-credentials/) and [internal distribution](https://docs.expo.dev/build/internal-distribution/).
4. In both EAS `preview` and `production` environments, set `EAS_PROJECT_ID` and `EXPO_ACCOUNT_OWNER` as plain-text environment variables. For a local-only release, leave `EXPO_PUBLIC_RECALL_API_URL`, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` unset or blank in both your shell and EAS environment. To enable cloud features, supply all three public client values together. `EXPO_PUBLIC_RECALL_API_URL` must be a client-reachable HTTPS ASP.NET API origin or gateway serving the app's routes; the client sends Supabase bearer tokens directly and does not use browser cookies. Use the public Supabase publishable key or legacy `anon` key. Client variables are embedded in the application. Never configure provider API keys, Supabase service-role keys or OAuth secrets as `EXPO_PUBLIC_*` values. EAS environment resolution is described in [Expo's environment guide](https://docs.expo.dev/eas/environment-variables/usage/).

The preflight checks environment shapes without contacting Expo. Actual token permissions, project ownership, credentials, device provisioning and account billing are checked by Expo when a build is explicitly requested.

## Local commands

Export the same project, owner, token and public client variables in your shell. The release scripts read the process environment; they do not automatically load `.env` files. EAS CLI is pinned to `24.10.0` and fetched through `pnpm dlx` only when requesting a cloud build.

From the repository root:

```bash
pnpm --filter mobile release:check
pnpm --filter mobile release:preview
pnpm --filter mobile release:production
```

The build scripts request both platforms and run through pnpm without a command shell, including on Windows. The direct `node` build examples below assume a Unix shell with pnpm on the executable path; on Windows use the package release scripts. To build one platform, run from `apps/mobile`:

```bash
node scripts/eas-release.mjs check preview android
node scripts/eas-release.mjs build preview android
node scripts/eas-release.mjs build production ios
```

The preflight requires Expo project/account/token configuration. Cloud client configuration is optional: all three values blank permits a local-only release, while a partial set, placeholder, loopback/HTTP endpoint or non-public Supabase key fails before EAS starts. Build commands wait for the result and expose Expo's artifact links in their output. Commands run from the mobile app directory while EAS uploads the workspace according to [Expo's monorepo guidance](https://docs.expo.dev/build-reference/build-with-monorepos/).

## Manual GitHub workflow

Create GitHub environments named `mobile-preview` and `mobile-production`. Add `EXPO_TOKEN` as an environment secret. Add the project ID and owner as environment variables. Set the three public client variables only for cloud-enabled builds, matching the corresponding EAS environment; leave all three blank for local-only builds. Configure environment reviewers for production if desired.

Run **Mobile builds** manually, choose the profile and Android, iOS or both. The workflow installs the frozen workspace, validates configuration and requests the selected build with a pinned CLI. It has no push, tag or pull-request trigger. Expo hosts the signed artifact; the workflow log includes the build result and download links. Expo documents [non-interactive builds from CI](https://docs.expo.dev/build/building-on-ci/).

Creating a store artifact does not submit it to an app store. Submission, store listings, privacy disclosures, app icons, store screenshots and device-level release validation remain separate external release steps. This configuration pass has not contacted EAS to build, submitted an app, or exercised device behavior.
