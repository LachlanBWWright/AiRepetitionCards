import typedStrict from "../eslint.typed.mjs";

export default [
  ...typedStrict,
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
  {
    files: ["packages/infra-study-materials/src/index-docx.ts"],
    // fast-xml-parser's validator works in browsers/Hermes. Its recommended replacement
    // fast-xml-validator@1.4.2 loads a Node Buffer dependency before validation runs.
    rules: { "@typescript-eslint/no-deprecated": "off" },
  },
];
