// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";
import prettier from "eslint-config-prettier";
import typedStrict from "../../eslint.typed.mjs";
import tseslint from "typescript-eslint";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "storybook-static/**",
    "public/app-shell/**",
    "public/vendor/ocr/**",
    "public/service-worker.js",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  ...storybook.configs["flat/recommended"],
  ...typedStrict,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["pwa/**/*.{ts,tsx}"],
  })),
  {
    files: ["pwa/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["pwa/image.tsx"],
    // The cached shell bundles images without an image optimization server.
    rules: { "@next/next/no-img-element": "off" },
  },
  prettier,
]);

export default eslintConfig;
