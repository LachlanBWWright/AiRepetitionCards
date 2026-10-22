import { svgParserEsm } from "./svg-parser-esm";
import type { StorybookConfig } from "@storybook/react-vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeConfig,
  transformWithEsbuild,
  type Alias,
  type AliasOptions,
  type UserConfig,
} from "vite";

function isAliasArray(aliases: AliasOptions): aliases is readonly Alias[] {
  return Array.isArray(aliases);
}

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: [
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../../packages/ui-web/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../../packages/ui-native/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
  framework: "@storybook/react-vite",
  typescript: { reactDocgen: "react-docgen-typescript" },
  staticDirs: ["../public"],
  viteFinal(config) {
    const merged: UserConfig = mergeConfig(config, {
      // React Native navigation dependencies expect Metro's development flag.
      define: { "process.env": {}, __DEV__: false },
      optimizeDeps: {
        include: [
          "react",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "react-dom",
          "react-dom/client",
          "react-native-web",
          "sql.js",
          // This linked adapter contains MathJax CommonJS modules; prebundle them for browser ESM.
          "@recall/infra-rich-content",
        ],
        noDiscovery: true,
      },
      root: path.resolve(configDirectory, ".."),
      resolve: {
        extensions: [
          ".web.mjs",
          ".mjs",
          ".web.js",
          ".js",
          ".web.ts",
          ".ts",
          ".web.tsx",
          ".tsx",
          ".jsx",
          ".json",
        ],
        dedupe: ["react", "react-dom", "react-native-web"],
      },
      plugins: [
        svgParserEsm(),
        {
          name: "storybook-rn-primitives-jsx",
          enforce: "pre",
          async transform(code: string, id: string) {
            const sourceId = id.split("?", 1)[0] ?? id;
            if (!sourceId.includes("/@rn-primitives/slot/") || !sourceId.endsWith(".mjs"))
              return null;
            return transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" });
          },
        },
      ],
    });
    const configuredAliases = merged.resolve?.alias ?? [];
    const aliases = isAliasArray(configuredAliases)
      ? configuredAliases
      : Object.entries(configuredAliases).map(([find, replacement]) => ({ find, replacement }));
    merged.resolve = {
      ...merged.resolve,
      alias: [
        {
          find: /^expo-crypto$/,
          replacement: fileURLToPath(new URL("./ExpoCryptoMock.ts", import.meta.url)),
        },
        { find: /^@\//, replacement: `${path.resolve(configDirectory, "../src")}/` },
        {
          find: /^next\/link$/,
          replacement: path.resolve(configDirectory, "NextLinkMock.tsx"),
        },
        {
          find: /^@recall\/ui-native$/,
          replacement: path.resolve(configDirectory, "NativeUiMocks.tsx"),
        },
        {
          find: /^@expo\/ui(?:\/.*)?$/,
          replacement: path.resolve(configDirectory, "ExpoUiMocks.tsx"),
        },
        {
          find: /^expo$/,
          replacement: path.resolve(configDirectory, "ExpoUiMocks.tsx"),
        },
        {
          find: /^expo-(?:file-system|sharing)(?:\/.*)?$/,
          replacement: path.resolve(configDirectory, "NativePlatformServiceMocks.ts"),
        },
        {
          find: /^expo-modules-core(?:\/.*)?$/,
          replacement: path.resolve(configDirectory, "ExpoUiMocks.tsx"),
        },
        {
          find: /^@react-native\/assets-registry(?:\/.*)?$/,
          replacement: path.resolve(configDirectory, "NativeAssetMocks.ts"),
        },
        { find: /^react-native$/, replacement: "react-native-web" },
        ...aliases,
      ],
    };
    return Promise.resolve(merged);
  },
};
export default config;
