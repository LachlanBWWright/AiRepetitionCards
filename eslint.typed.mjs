import tseslint from "typescript-eslint";
import neverthrow from "eslint-plugin-neverthrow";
import { fixupPluginRules } from "@eslint/compat";

const files = ["**/*.{ts,tsx,mts,cts}"];

export default [
  { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" } },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files,
  })),
  {
    files,
    // The upstream neverthrow plugin uses the pre-ESLint 9 rule context API.
    plugins: { neverthrow: fixupPluginRules(neverthrow) },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "neverthrow/must-use-result": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-check": false,
          "ts-expect-error": true,
          "ts-ignore": true,
          "ts-nocheck": true,
        },
      ],
    },
  },
];
