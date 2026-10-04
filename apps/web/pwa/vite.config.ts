import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const directory = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, resolve(directory, ".."), "NEXT_PUBLIC_");
  return {
    root: directory,
    base: "/app-shell/",
    publicDir: false,
    resolve: {
      alias: {
        "@": resolve(directory, "../src"),
        "next/image": resolve(directory, "image.tsx"),
        "next/link": resolve(directory, "link.tsx"),
      },
    },
    define: {
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(
        environment.NEXT_PUBLIC_SUPABASE_URL ?? "",
      ),
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
      ),
      "process.env.NEXT_PUBLIC_RECALL_API_URL": JSON.stringify(
        environment.NEXT_PUBLIC_RECALL_API_URL ?? "",
      ),
      "process.env.NEXT_PUBLIC_RECALL_ASSET_BASE": JSON.stringify("/"),
    },
    css: { postcss: resolve(directory, "../postcss.config.mjs") },
    build: { outDir: resolve(directory, "../public/app-shell"), emptyOutDir: true },
  };
});
