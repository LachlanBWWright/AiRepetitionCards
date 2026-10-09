import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(root, "../../artifacts/e2e");
const publicRoot = resolve(root, "public");
const storyRoot = resolve(root, "storybook-static");
const argumentsList = process.argv.slice(2);
if (argumentsList.length === 1 && argumentsList[0] === "--help") {
  process.stdout.write(
    "Usage: test:e2e [--check] [filename.test.mjs ...]\n--check checks syntax only; no builds, servers or browsers.\n",
  );
  process.exit(0);
}
const availableTests = (await readdir(resolve(root, "tests/e2e")))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();
const selectedTests = argumentsList.filter((argument) => argument !== "--check");
if (
  availableTests.length === 0 ||
  selectedTests.some((name) => !availableTests.includes(name)) ||
  new Set(argumentsList).size !== argumentsList.length
) {
  process.stderr.write(
    "Unknown or repeated E2E arguments. Use --help or a known filename.test.mjs. No builds, servers or browsers started.\n",
  );
  process.exit(1);
}
const testFiles = selectedTests.length ? selectedTests : availableTests;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".gz": "application/gzip",
};

function run(command, args, environment = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...environment },
    });
    child.on("error", (error) => {
      process.stderr.write(`${error.message}\n`);
      resolveResult(1);
    });
    child.on("exit", (code) => resolveResult(code ?? 1));
  });
}

async function serve(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const story = pathname.startsWith("/storybook/");
  const directory = story ? storyRoot : publicRoot;
  const relative = story ? pathname.slice("/storybook/".length) : pathname.slice(1);
  let filename = resolve(directory, relative || "index.html");
  if (!filename.startsWith(directory + sep) && filename !== directory) {
    response.writeHead(403).end();
    return;
  }
  if ((await stat(filename)).isDirectory()) filename = resolve(filename, "index.html");
  const content = await readFile(filename);
  response.writeHead(200, {
    "Content-Type": mime[extname(filename)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
    "Service-Worker-Allowed": "/",
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

if (argumentsList.includes("--check")) {
  const checks = [
    "scripts/run-e2e.mjs",
    ...(await readdir(resolve(root, "tests/e2e")))
      .filter(
        (name) =>
          name.endsWith(".mjs") && (!name.endsWith(".test.mjs") || testFiles.includes(name)),
      )
      .sort()
      .map((name) => `tests/e2e/${name}`),
  ];
  let checked = 0;
  for (const file of checks)
    checked = Math.max(checked, await run(process.execPath, ["--check", file]));
  process.exit(checked);
}

await mkdir(artifacts, { recursive: true });
let result = 0;
if (process.env.RECALL_E2E_SKIP_BUILD !== "1") {
  result = await run(process.execPath, ["pwa/build.mjs"], {
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    NEXT_PUBLIC_RECALL_API_URL: "",
  });
  if (result === 0)
    result = await run(process.execPath, [
      "node_modules/storybook/dist/bin/dispatcher.js",
      "build",
      "--quiet",
    ]);
}
if (result === 0) {
  const server = createServer((request, response) => {
    void serve(request, response).catch(() => response.writeHead(404).end("Not found"));
  });
  await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const address = server.address();
  try {
    result = await run(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        "--test-timeout=90000",
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        "--test-reporter=junit",
        `--test-reporter-destination=${resolve(artifacts, "results.xml")}`,
        ...testFiles.map((name) => `tests/e2e/${name}`),
      ],
      { RECALL_E2E_URL: `http://127.0.0.1:${address.port}`, RECALL_E2E_ARTIFACTS: artifacts },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
}
await writeFile(
  resolve(artifacts, "summary.json"),
  JSON.stringify({ success: result === 0, exitCode: result }, null, 2),
);
process.exitCode = result;
