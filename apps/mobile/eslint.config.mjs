import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(["dist/**", ".expo/**", "out/**", "build/**"]),
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
  prettier,
]);
