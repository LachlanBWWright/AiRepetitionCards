import type { StorybookConfig } from "@storybook/react-vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig, transformWithEsbuild } from "vite";

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
  async viteFinal(config) {
    const merged = mergeConfig(config, {
      optimizeDeps: {
        include: [
          "react",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "react-dom",
          "react-dom/client",
          "react-native-web",
        ],
        noDiscovery: true,
      },
      root: path.resolve(configDirectory, ".."),
      resolve: {
        dedupe: ["react", "react-dom", "react-native-web"],
      },
      plugins: [
        {
          name: "storybook-rn-primitives-jsx",
          enforce: "pre",
          async transform(code, id) {
            const sourceId = id.split("?", 1)[0] ?? id;
            if (!sourceId.includes("/@rn-primitives/slot/") || !sourceId.endsWith(".mjs"))
              return null;
            return transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" });
          },
        },
      ],
    });
    const aliases = Array.isArray(merged.resolve.alias) ? merged.resolve.alias : [];
    merged.resolve.alias = [
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
        find: /^expo-modules-core(?:\/.*)?$/,
        replacement: path.resolve(configDirectory, "ExpoUiMocks.tsx"),
      },
      {
        find: /^@react-native\/assets-registry(?:\/.*)?$/,
        replacement: path.resolve(configDirectory, "NativeAssetMocks.ts"),
      },
      { find: /^react-native$/, replacement: "react-native-web" },
      ...aliases,
    ];
    return merged;
  },
};
export default config;
