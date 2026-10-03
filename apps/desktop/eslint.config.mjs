import prettier from "eslint-config-prettier";
import typedStrict from "../../eslint.typed.mjs";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(["out/**", "dist/**", "build/**"]),
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
  ...typedStrict,
  prettier,
]);
