import prettier from "eslint-config-prettier";
import typedStrict from "../../eslint.typed.mjs";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(["dist/**", ".expo/**", "out/**", "build/**"]),
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
  ...typedStrict,
  {
    files: ["metro.config.cjs", "tailwind.config.cjs"],
    // NativeWind's documented Metro/Tailwind loaders consume CommonJS config.
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  prettier,
]);
