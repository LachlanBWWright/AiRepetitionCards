import type { StorybookConfig } from "@storybook/nextjs-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  stories: [
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../../packages/ui-web/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../../packages/ui-native/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
  framework: "@storybook/nextjs-vite",
  typescript: { reactDocgen: "react-docgen-typescript" },
  staticDirs: ["../public"],
  async viteFinal(config) {
    return mergeConfig(config, {
      resolve: {
        dedupe: ["react", "react-dom", "react-native-web"],
        alias: [{ find: /^react-native$/, replacement: "react-native-web" }],
      },
    });
  },
};
export default config;
