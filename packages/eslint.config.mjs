import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["packages/scheduler/src/**/*.ts"],
    // ts-fsrs v5 marks Card.elapsed_days deprecated but still requires it as scheduler input.
    rules: { "@typescript-eslint/no-deprecated": "off" },
  },
  {
    files: ["packages/infra-supabase/src/database.types.ts"],
    // Supabase CLI emits helper generics with `never` unions for schemas without enums/composites.
    rules: { "@typescript-eslint/no-redundant-type-constituents": "off" },
  },
);
