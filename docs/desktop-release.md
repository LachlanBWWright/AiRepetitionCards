# Desktop release guide

Release build source supports Linux x64 AppImage, macOS x64/ARM64 DMG and ZIP, and Windows x64 NSIS. Unsigned development packages and signed release candidates have separate workflows. No signed artifact or target-OS runtime acceptance is established by checking in these workflows.

## Development artifacts

Run commands from the repository root after `pnpm install --frozen-lockfile`:

| Target OS   | Unsigned command                       | Output                             |
| ----------- | -------------------------------------- | ---------------------------------- |
| Linux x64   | `pnpm --filter desktop dist:linux`     | `apps/desktop/release/*.AppImage`  |
| macOS x64   | `pnpm --filter desktop dist:mac`       | `apps/desktop/release/*.{dmg,zip}` |
| macOS ARM64 | `pnpm --filter desktop dist:mac:arm64` | `apps/desktop/release/*.{dmg,zip}` |
| Windows x64 | `pnpm --filter desktop dist:windows`   | `apps/desktop/release/*.exe`       |

Each command specifies its architecture and disables publishing. macOS development builds disable signing, hardened runtime and notarization; Windows development builds disable signing. The `Desktop packages (unsigned development)` workflow remains manual or triggered by `desktop-v*` tags. It uploads artifacts named `recall-unsigned-*` for 14 days. Development Linux AppImages have checksums without a publisher signature.

Build on the target OS. macOS x64 and ARM64 are packaged separately with explicit flags on `macos-14`; cross-packaging does not establish execution on both architectures. CI's unpacked Linux `package:desktop` bundle is packaging evidence only. [electron-builder architecture guidance](https://www.electron.build/v26/docs/mac/).

## Signed release candidates

The manual `Desktop packages (signed release candidates)` workflow builds macOS x64/ARM64 and Windows x64, and uploads `recall-signed-*` artifacts. Its separate Linux x64 job uploads `recall-publisher-signed-linux-x64` with a signed checksum manifest. It does not publish a release. Signed builds can opt into the startup update mechanism described below. Signed commands are `dist:mac:signed`, `dist:mac:arm64:signed` and `dist:windows:signed`.

Before enabling it, create the GitHub environment **desktop-release**, restrict deployment branches/tags to reviewed release source, and require approval with self-review disabled. Configure these environment secrets:

| Platform | Required secrets                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | `MAC_CSC_LINK` (base64 Developer ID Application `.p12`), `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows  | `WIN_CSC_LINK` (base64 exportable Authenticode `.pfx`), `WIN_CSC_KEY_PASSWORD`                                                              |

Never commit certificate files or passwords. GitHub protection and reviewer configuration are external requirements: a workflow reference alone does not protect an environment, and an absent environment can be created without protections. [GitHub environment setup](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

The workflow fails when required credentials are empty and requires signing through `forceCodeSigning`. macOS enables hardened runtime, timestamps, explicit Electron JIT entitlements for app/helpers, and Apple notarization. Before upload it checks the app signature, Gatekeeper assessment and stapled notarization ticket. Windows uses SHA-256 Authenticode with an RFC 3161 timestamp; both the installed executable and installer must have valid timestamped signatures. This implementation targets the pinned electron-builder v26 configuration. [Signing](https://www.electron.build/v26/docs/features/code-signing/), [macOS notarization](https://www.electron.build/v26/docs/notarization/), [Windows configuration](https://www.electron.build/v26/docs/win/).

Windows requires a certificate/provider that actually supports this CI signing method; hardware-bound certificates are not implemented by exporting a `.pfx`. Certificate issuance, Apple membership, accepted Apple agreements, certificate validity, notarization service access and environment approval remain external gates.

The Linux job checks the imported private key against the configured full fingerprint, signs `checksums.json`, verifies the detached signature in a separate public-only keyring, and uploads `checksums.json.asc` plus `publisher-key.asc`. Temporary keyrings are removed when signing finishes or fails. This provides publisher authenticity for the manifest; it does not add an OS signature to the AppImage. Consumers must obtain the publisher fingerprint through an independently trusted channel, confirm the public key fingerprint, verify the manifest signature, then compare the AppImage hash. Trusting a key solely because it accompanied a download provides no publisher authentication. [GnuPG signing and verification](https://www.gnupg.org/documentation/manuals/gnupg/Operational-GPG-Commands.html).

## Configuration and artifact integrity

Signed builds read public environment variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `RECALL_API_URL` from the protected environment's variables. Set `RECALL_API_URL` to the client-reachable HTTPS ASP.NET API origin or gateway; do not bundle an internal-only service address. Leave the client values unset to disable cloud features. Local builds can use the web app's environment file. Never bundle Supabase service-role keys, OpenAI secrets or signing credentials as public client configuration. ASP.NET's service-role, AI-provider, OAuth, Redis and trusted-proxy settings belong only in the API's server environment; see [backend configuration](../backend/README.md).

Both workflows include `checksums.json` with SHA-256 hashes and sizes for every installer/archive. Compare every downloaded file to that manifest. Checksums establish byte integrity; they do not replace OS signature validation or authenticate unsigned Linux distribution.

Packaged applications declare the `recall` URL scheme through electron-builder `protocols`, including macOS `CFBundleURLTypes`. Configure the Supabase redirect allowlist for the application’s `recall://` email callback, and verify delivery to an installed app during release acceptance. Runtime registration alone does not supply macOS bundle metadata. [Protocol configuration](https://www.electron.build/v26/docs/configuration/#protocols).

## Release acceptance gates

Before shipping, obtain a successful signed workflow run and retain its verification logs and manifests. Install the downloaded candidates on clean target OS accounts and both macOS architectures, then confirm:

1. Creation, study and restart preserve local SQLite data and media.
2. Email-link sign-in, cloud sync and media use the intended API.
3. Encrypted credential storage and configured ChatGPT sign-in work on the installed app.
4. OS trust assessment succeeds on downloaded artifacts without development tools.

These device checks, production service configuration, independently trusted Linux publisher fingerprint distribution and actual signed update delivery remain pending until independently verified. Do not distribute unsigned development artifacts as a production release.

## Startup updates and upgrade recovery

Signed macOS/Windows builds support optional startup update checks with pinned `electron-updater`
6.8.3, matching this repository's electron-builder 26 API. Configure protected-environment variable
`RECALL_DESKTOP_UPDATE_URL` with an HTTPS generic-provider feed. Windows also requires
`RECALL_DESKTOP_UPDATE_PUBLISHER` matching the signing certificate subject. The build rejects
update-enabled unsigned packages and insecure, credential-bearing or malformed feed addresses.
The runtime embeds and revalidates that configured feed. Leaving it unset disables update checks;
Linux retains its separately signed-manifest distribution.

The signed workflow includes generated `latest*.yml` update metadata and `.blockmap` files in the
artifact alongside installers/ZIPs. Publish the appropriate platform/architecture files and metadata
at the configured feed after signed artifact acceptance, preserving generated names and hashes.
Keep architecture-specific feeds separate (particularly macOS x64 and ARM64), and use increasing
application versions. Publishing/hosting the feed is an external release step; the workflow never
uploads it automatically. Never point the stable feed at unsigned development artifacts.

Checks run before the main window opens, with a five-second limit on the initial network check.
Offline/unavailable checks leave local startup available. Available updates require download consent
and installation consent. The installer runs only during this startup phase, so it cannot interrupt a
review or unsaved editor. Install-on-normal-quit, prereleases, downgrades and NSIS web installers are
disabled. macOS verifies update signatures against the application identity; Windows uses the
configured publisher verification. Both also verify downloaded hashes. Actual signature rejection
and download/install/relaunch behavior must be exercised on signed target-OS candidates.

Before installation, Recall makes an online SQLite backup including WAL content and media. Startup
also creates a backup before the first run of a different application version against an existing
collection. A failed backup blocks upgrade processing/installation. Copies remain in the app's
`userData/upgrade-backups` directory; they are private, unencrypted SQLite recovery files and are
retained until deliberately removed. With Recall closed, preserve the current database and its
sidecars before restoring a copy as `recall.sqlite`. Prefer the normal private backup import for
routine transfers. Test previous-version upgrades and recovery on signed candidates before shipping.
