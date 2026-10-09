import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { offlineIcon } from "./icon.mjs";
import { prepareOcrAssets } from "../scripts/prepare-ocr-assets.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));
const destination = resolve(directory, "../public");
const base = "/";
async function filesWithin(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      files.push(...(await filesWithin(resolve(directory, entry.name), `${name}/`)));
    else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}
await prepareOcrAssets();
await build({ configFile: resolve(directory, "vite.config.ts") });
await writeFile(
  resolve(destination, "index.html"),
  await readFile(resolve(destination, "app-shell/index.html")),
);
for (const size of [192, 512])
  await writeFile(resolve(destination, `recall-icon-${size}.png`), offlineIcon(size));
await writeFile(
  resolve(destination, "manifest.webmanifest"),
  JSON.stringify(
    {
      id: base,
      name: "Recall",
      short_name: "Recall",
      description: "Study your learning areas with your Recall account.",
      lang: "en",
      start_url: base,
      scope: base,
      display: "standalone",
      background_color: "#faf9f6",
      theme_color: "#29322b",
      icons: [192, 512].map((size) => ({
        src: `${base}recall-icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "any maskable",
      })),
    },
    null,
    2,
  ),
);
const files = [
  ...(await filesWithin(resolve(destination, "app-shell"), "app-shell/")),
  "index.html",
  "manifest.webmanifest",
  "recall-icon-192.png",
  "recall-icon-512.png",
  "vendor/sql-wasm.wasm",
  ...(await filesWithin(resolve(destination, "vendor/ocr"), "vendor/ocr/")),
].sort();
const digest = createHash("sha256").update(base);
for (const file of files) digest.update(file).update(await readFile(resolve(destination, file)));
const cachePrefix = `recall-offline-${createHash("sha256").update(base).digest("hex").slice(0, 12)}-`;
const cacheName = `${cachePrefix}${digest.digest("hex").slice(0, 24)}`;
const urls = files.map((file) => `${base}${file}`);
// Only build-owned static paths are admitted; API/auth and private workspace data never enter this cache.
await writeFile(
  resolve(destination, "service-worker.js"),
  `
const CACHE = ${JSON.stringify(cacheName)};
const CACHE_PREFIX = ${JSON.stringify(cachePrefix)};
const ASSETS = ${JSON.stringify(urls)};
const BASE = ${JSON.stringify(base)};
const STATIC = new Set(ASSETS);
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(async names => {
    const scoped = names.filter(name => name.startsWith(CACHE_PREFIX));
    const previous = scoped.filter(name => name !== CACHE).slice(-2);
    await Promise.all(scoped.filter(name => name !== CACHE && !previous.includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  }));
});
self.addEventListener("message", event => {
  if (event.data && event.data.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("notificationclick", event => {
  if (!event.notification.data || event.notification.data.kind !== "daily-study-reminder") return;
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    const client = clients.find(candidate => new URL(candidate.url).origin === self.location.origin);
    if (client) {
      client.postMessage({ type: "recall-daily-reminder-open" });
      await client.focus();
    } else {
      await self.clients.openWindow(BASE);
    }
  }));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const rootNavigation = url.pathname === BASE || url.pathname === BASE + "index.html";
  if (request.mode === "navigate" && rootNavigation) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const fallback = () => caches.open(CACHE).then(cache => cache.match(BASE + "app-shell/index.html"));
    event.respondWith(fetch(request, { signal: controller.signal })
      .then(response => response.status >= 500 ? fallback().then(shell => shell || response) : response)
      .catch(fallback)
      .finally(() => clearTimeout(timeout)));
    return;
  }
  if (url.search || (!STATIC.has(url.pathname) && !url.pathname.startsWith(BASE + "app-shell/assets/"))) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const current = await cache.match(url.pathname);
    if (current) return current;
    const names = await caches.keys();
    const previous = names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE).slice(-2);
    for (const name of previous.reverse()) {
      const old = await (await caches.open(name)).match(url.pathname);
      if (old) return old;
    }
    return fetch(request);
  }));
});
`,
);
process.stdout.write(
  `Web offline cache generated: ${files.length} precached static files at ${base}.\n`,
);
