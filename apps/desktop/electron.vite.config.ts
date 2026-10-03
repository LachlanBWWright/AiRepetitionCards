import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";

const appDirectory = fileURLToPath(new URL(".", import.meta.url));
const webSource = resolve(appDirectory, "../web/src");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(appDirectory, "../web"), "");
  const configuredApiUrl = env.RECALL_API_URL ?? env.NEXT_PUBLIC_RECALL_API_URL;
  const publicEnvironment = {
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
    "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    ),
    "process.env.RECALL_API_URL": JSON.stringify(
      configuredApiUrl ?? (mode === "development" ? "http://localhost:3000" : ""),
    ),
  };
  return {
    main: { define: publicEnvironment },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: { rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } } },
    },
    renderer: {
      root: resolve(appDirectory, "src/renderer"),
      resolve: { alias: { "@": webSource } },
      plugins: [react()],
      css: { postcss: resolve(appDirectory, "../web/postcss.config.mjs") },
      define: publicEnvironment,
    },
  };
});
