import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: [
      "apps/web/src/**/*.{ts,tsx}",
      "apps/mobile/**/*.{ts,tsx}",
      "apps/desktop/src/**/*.{ts,tsx}",
    ],
  })),
  {
    files: [
      "apps/web/src/**/*.{ts,tsx}",
      "apps/mobile/**/*.{ts,tsx}",
      "apps/desktop/src/**/*.{ts,tsx}",
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
