# ADR 0010: NativeWind styling foundation

- Status: accepted
- Date: 2026-10-03

## Decision

Use stable NativeWind **4.2.7** with `react-native-css-interop` **0.2.7** and mobile-local Tailwind CSS **3.4.17**. The [official installation guide](https://www.nativewind.dev/docs/getting-started/installation) explicitly documents this release's Expo SDK 57 support and retains the v4 Babel/Metro configuration. Web keeps its independent Tailwind 4 toolchain.

Pin native dependencies to the installed Expo SDK 57 compatibility manifest: Reanimated **4.5.1**, Worklets **0.10.1**, and safe-area-context **5.7.0**. Pin `babel-preset-expo` **57.0.13**, matching the installed Expo preset. These versions establish a documented source/build baseline; they do not prove device compatibility.

Mobile's Babel config selects NativeWind's JSX import source and Babel preset. Metro wraps Expo's default config with `withNativeWind` and reads `global.css`. The entry imports that CSS, TypeScript loads NativeWind's React Native augmentation, and Tailwind scans both app components and the shared native UI package. The existing app root uses `flex-1 bg-recall-paper` so the integration participates in application rendering.

The Tailwind theme reads canonical `packages/design-tokens/tokens.json` for colors, spacing and radii. Shared native primitives retain their existing `StyleSheet` implementation so Storybook's Vite/react-native-web catalog does not acquire a Metro or NativeWind runtime dependency. NativeWind is an app composition concern; shared semantics and tokens remain portable.

## Consequences

Run `pnpm --filter mobile start --clear` after changing Babel, Metro or NativeWind configuration. Rebuild native development clients after native dependency changes. Use documented utility classes for new native layout work, while preserving native accessibility and gestures.

Metro/Tailwind `.cjs` configurations use the documented CommonJS loaders. ESLint's `no-require-imports` exception is restricted to those two configuration files; application TypeScript remains strict with no inline suppressions.

Android/iOS JavaScript exports and type/lint checks provide compilation evidence. Appearance, animations, safe-area behavior and interactions still require real device validation, deferred by the current instruction to complete implementation before runtime testing.
