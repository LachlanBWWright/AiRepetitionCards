#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiProject = path.join(repositoryRoot, "backend", "Recall.Api");
const clientModes = new Set(["next", "desktop", "mobile"]);
const clientCommands = {
  next: {
    appDirectory: path.join(repositoryRoot, "apps", "web"),
    executable: "next",
    args: ["dev"],
    prepare: ["scripts/prepare-ocr-assets.mjs"],
  },
  desktop: {
    appDirectory: path.join(repositoryRoot, "apps", "desktop"),
    executable: "electron-vite",
    args: ["dev"],
    prepare: ["../web/scripts/prepare-ocr-assets.mjs", "desktop"],
  },
  mobile: {
    appDirectory: path.join(repositoryRoot, "apps", "mobile"),
    executable: "expo",
    args: ["start"],
  },
};
const publicSupabaseKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];

function printUsage() {
  process.stdout.write(
    "Usage: pnpm dev:api:<next|desktop|mobile>\n\n" +
      "Starts the .NET API, waits for its health endpoint, then starts the selected client.\n" +
      "Set RECALL_API_URL for Next.js/Electron or EXPO_PUBLIC_RECALL_API_URL for Expo.\n" +
      "Set RECALL_API_BIND_URL to change the backend bind address (default http://0.0.0.0:5000).\n" +
      "Optional backend-only settings can go in .env.backend.local at the repository root.\n",
  );
}

function parseEnvText(contents, filePath) {
  const parsed = {};
  for (const [index, rawLine] of contents
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!assignment) {
      throw new Error(`${filePath}:${index + 1}: expected KEY=value`);
    }

    const [, key, source] = assignment;
    let value = source.trim();
    const quote = value[0];
    if (quote === "'" || quote === '"' || quote === "`") {
      const closing = value.lastIndexOf(quote);
      if (closing === 0) throw new Error(`${filePath}:${index + 1}: unterminated quoted value`);
      const trailing = value.slice(closing + 1).trim();
      if (trailing && !trailing.startsWith("#")) {
        throw new Error(`${filePath}:${index + 1}: unexpected text after quoted value`);
      }
      value = value.slice(1, closing);
      if (quote === '"')
        value = value.replace(/\\([nrt"\\])/g, (_, escaped) => {
          switch (escaped) {
            case "n":
              return "\n";
            case "r":
              return "\r";
            case "t":
              return "\t";
            default:
              return escaped;
          }
        });
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    parsed[key] = value;
  }
  return parsed;
}

async function readEnvFile(relativePath) {
  const fullPath = path.join(repositoryRoot, relativePath);
  try {
    return parseEnvText(await readFile(fullPath, "utf8"), relativePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

function localSupabaseEnvironment(env = process.env) {
  const result = spawnSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    values[key] = rawValue.replace(
      /^(?:"(.*)"|'(.*)')$/,
      (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted,
    );
  }
  const url = values.API_URL;
  const publishableKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  if (!url || !publishableKey) return null;
  return {
    url,
    publishableKey,
    ...(values.SERVICE_ROLE_KEY ? { serviceRoleKey: values.SERVICE_ROLE_KEY } : {}),
  };
}

function startLocalSupabase(env = process.env) {
  return spawnSync("pnpm", ["exec", "supabase", "start"], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function resolveSupabaseDockerEnvironment() {
  const direct = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    cwd: repositoryRoot,
    stdio: "ignore",
    windowsHide: true,
  });
  if (direct.status === 0) return { env: process.env, bridgeDirectory: null };
  if (process.platform !== "linux") return { env: process.env, bridgeDirectory: null };

  const detected = spawnSync("which", ["docker.exe"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  const windowsDocker =
    detected.status === 0
      ? detected.stdout.trim()
      : "/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe";
  if (!windowsDocker || !existsSync(windowsDocker))
    return { env: process.env, bridgeDirectory: null };

  const windowsDockerReady = spawnSync(
    windowsDocker,
    ["--context", "desktop-linux", "info", "--format", "{{.ServerVersion}}"],
    { cwd: repositoryRoot, stdio: "ignore", windowsHide: true },
  );
  if (windowsDockerReady.status !== 0) return { env: process.env, bridgeDirectory: null };

  const bridgeDirectory = await mkdtemp(path.join(tmpdir(), "recall-docker-bridge-"));
  const bridgeExecutable = path.join(bridgeDirectory, "docker");
  await writeFile(
    bridgeExecutable,
    `#!/bin/sh\nexec ${shellQuote(windowsDocker)} --context desktop-linux "$@"\n`,
    { mode: 0o700 },
  );
  await chmod(bridgeExecutable, 0o700);
  return {
    env: {
      ...process.env,
      PATH: `${bridgeDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    bridgeDirectory,
  };
}

function usableDotnet(command) {
  const result = spawnSync(command, ["--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  return result.status === 0 && Number.parseInt(result.stdout.trim().split(".")[0] ?? "", 10) >= 10;
}

function resolveDotnet() {
  const configured = process.env.DOTNET?.trim();
  if (configured) {
    if (usableDotnet(configured)) return configured;
    throw new Error("DOTNET must point to a working .NET 10 SDK executable.");
  }

  if (usableDotnet("dotnet")) return "dotnet";
  const local = path.join(
    homedir(),
    ".dotnet",
    process.platform === "win32" ? "dotnet.exe" : "dotnet",
  );
  if (usableDotnet(local)) return local;
  throw new Error("The .NET 10 SDK is required. Install it or set DOTNET to its executable.");
}

function healthUrl(bindUrl) {
  let url;
  try {
    url = new URL(bindUrl);
  } catch {
    throw new Error("RECALL_API_BIND_URL must be an absolute HTTP or HTTPS URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("RECALL_API_BIND_URL must contain only an HTTP(S) scheme, host, and port.");
  }
  if (["0.0.0.0", "*", "+"].includes(url.hostname)) url.hostname = "127.0.0.1";
  return new URL("/health", url).toString();
}

function clientUrlFromBind(bindUrl) {
  const url = new URL(bindUrl);
  if (["0.0.0.0", "*", "+"].includes(url.hostname)) url.hostname = "localhost";
  return url.origin;
}

function startProcess(command, args, env, label, cwd) {
  const windows = process.platform === "win32";
  const executable = windows ? `${command}.cmd` : command;
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: windows,
    detached: !windows,
    windowsHide: true,
  });
  child.on("error", (error) => {
    process.stderr.write(`${label} could not start: ${error.message}\n`);
  });
  return child;
}

function prepareClient(mode, env) {
  const client = clientCommands[mode];
  if (!client.prepare) return;
  const scriptPath = path.join(client.appDirectory, client.prepare[0]);
  const result = spawnSync(process.execPath, [scriptPath, ...client.prepare.slice(1)], {
    cwd: client.appDirectory,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `${mode} asset preparation failed (${result.status ?? result.signal ?? "unknown"}).`,
    );
  }
}

function stopProcess(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

function processGroupExists(child) {
  if (process.platform === "win32" || !child?.pid) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(child, graceMs = 2_000) {
  if (!child?.pid) return;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    const leaderRunning = child.exitCode === null && child.signalCode === null;
    if (!leaderRunning && !processGroupExists(child)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  stopProcess(child, "SIGKILL");
  const forcedDeadline = Date.now() + 1_000;
  while (Date.now() < forcedDeadline) {
    const leaderRunning = child.exitCode === null && child.signalCode === null;
    if (!leaderRunning && !processGroupExists(child)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForHealth(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "not yet reachable";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The .NET API exited before becoming healthy (${child.exitCode ?? child.signalCode}).`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000), cache: "no-store" });
      if (response.ok) return;
      lastFailure = `health returned HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "connection failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `The .NET API did not become healthy within ${timeoutMs / 1_000}s (${lastFailure}).`,
  );
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--help" || mode === "-h") {
    printUsage();
    return;
  }
  if (!clientModes.has(mode)) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  const backendFile = await readEnvFile(".env.backend.local");
  const webEnv = await readEnvFile("apps/web/.env.local");
  const mobileEnv = mode === "mobile" ? await readEnvFile("apps/mobile/.env") : {};
  const dotnet = resolveDotnet();
  let localSupabaseStartedByLauncher = false;
  let localSupabase = null;
  const configuredSupabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    webEnv.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    backendFile.SUPABASE_URL;
  const configuredSupabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    webEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    backendFile.SUPABASE_PUBLISHABLE_KEY;
  const hasWebSupabaseConfig = Boolean(configuredSupabaseUrl && configuredSupabaseKey);
  if (mode === "next" && hasWebSupabaseConfig) {
    webEnv.NEXT_PUBLIC_SUPABASE_URL ||= configuredSupabaseUrl;
    webEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= configuredSupabaseKey;
  }
  let dockerEnvironment = { env: process.env, bridgeDirectory: null };
  if (mode === "next" && !hasWebSupabaseConfig) {
    dockerEnvironment = await resolveSupabaseDockerEnvironment();
    localSupabase = localSupabaseEnvironment(dockerEnvironment.env);
    if (!localSupabase) {
      process.stdout.write("Starting local Supabase for web account sign-in…\n");
      const startResult = startLocalSupabase(dockerEnvironment.env);
      localSupabaseStartedByLauncher = startResult.status === 0;
      localSupabase = localSupabaseEnvironment(dockerEnvironment.env);
      if (!localSupabase) {
        const startupOutput = `${startResult.stdout ?? ""}\n${startResult.stderr ?? ""}`;
        const startupReason = /docker(?:\.sock| api| daemon)|daemon is not running|cannot connect to the docker/i.test(
          startupOutput,
        )
          ? "Docker is unavailable, so local Supabase could not start."
          : "Local Supabase could not start.";
        process.stderr.write(
          `${startupReason} The web shell will still open, but card and study features require the account service.\n`,
        );
      }
    }
    if (localSupabase) {
      webEnv.NEXT_PUBLIC_SUPABASE_URL = localSupabase.url;
      webEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = localSupabase.publishableKey;
    }
  }
  const apiBindUrl = process.env.RECALL_API_BIND_URL?.trim() || "http://0.0.0.0:5000";
  const probeUrl = healthUrl(apiBindUrl);
  const defaultApiUrl = clientUrlFromBind(apiBindUrl);
  const apiUrl =
    process.env.RECALL_API_URL?.trim() || webEnv.RECALL_API_URL?.trim() || defaultApiUrl;
  const mobileApiUrl =
    process.env.EXPO_PUBLIC_RECALL_API_URL?.trim() ||
    mobileEnv.EXPO_PUBLIC_RECALL_API_URL?.trim() ||
    apiUrl;
  const baseEnvironment = { ...process.env };
  const apiEnvironment = { ...backendFile, ...baseEnvironment };

  if (localSupabase) {
    apiEnvironment.SUPABASE_URL = localSupabase.url;
    apiEnvironment.SUPABASE_PUBLISHABLE_KEY = localSupabase.publishableKey;
    if (localSupabase.serviceRoleKey)
      apiEnvironment.SUPABASE_SERVICE_ROLE_KEY = localSupabase.serviceRoleKey;
  }

  for (const key of publicSupabaseKeys) {
    if (apiEnvironment[key]) continue;
    const value = webEnv[key] ?? mobileEnv[key];
    if (value) apiEnvironment[key] = value;
  }
  if (!apiEnvironment.SUPABASE_URL && apiEnvironment.EXPO_PUBLIC_SUPABASE_URL) {
    apiEnvironment.SUPABASE_URL = apiEnvironment.EXPO_PUBLIC_SUPABASE_URL;
  }
  if (
    !apiEnvironment.SUPABASE_PUBLISHABLE_KEY &&
    apiEnvironment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    apiEnvironment.SUPABASE_PUBLISHABLE_KEY = apiEnvironment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  }
  apiEnvironment.ASPNETCORE_ENVIRONMENT ||= "Development";
  apiEnvironment.API_RATE_LIMIT_MODE ||= "memory";

  const clientEnvironment = { ...baseEnvironment };
  if (mode === "next") {
    if (webEnv.NEXT_PUBLIC_SUPABASE_URL)
      clientEnvironment.NEXT_PUBLIC_SUPABASE_URL = webEnv.NEXT_PUBLIC_SUPABASE_URL;
    if (webEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
      clientEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
        webEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (localSupabase?.serviceRoleKey)
      clientEnvironment.SUPABASE_SERVICE_ROLE_KEY = localSupabase.serviceRoleKey;
  }
  if (mode === "next" || mode === "desktop") clientEnvironment.RECALL_API_URL = apiUrl;
  if (mode === "mobile") clientEnvironment.EXPO_PUBLIC_RECALL_API_URL = mobileApiUrl;

  const client = clientCommands[mode];
  process.stdout.write(`Starting ASP.NET API at ${apiBindUrl}\n`);
  process.stdout.write(`API health check: ${probeUrl}\n`);
  if (mode === "mobile") {
    process.stdout.write(`Expo API origin: ${mobileApiUrl}\n`);
    if (
      new URL(mobileApiUrl).hostname === "localhost" ||
      new URL(mobileApiUrl).hostname === "127.0.0.1"
    ) {
      process.stdout.write(
        "For a physical phone, set EXPO_PUBLIC_RECALL_API_URL to this computer's LAN address.\n",
      );
    }
  } else {
    process.stdout.write(`Client API origin: ${apiUrl}\n`);
  }
  if (
    !(baseEnvironment.NEXT_PUBLIC_SUPABASE_URL || webEnv.NEXT_PUBLIC_SUPABASE_URL) ||
    !(
      baseEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      webEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    )
  ) {
    process.stdout.write(
      "Supabase account service is unavailable; the web shell will still start.\n",
    );
  }

  let apiProcess;
  let clientProcess;
  let stopping = false;
  let shutdownPromise;
  const shutdown = (exitCode = 0) => {
    if (stopping) return shutdownPromise;
    stopping = true;
    process.exitCode = exitCode;
    stopProcess(clientProcess);
    stopProcess(apiProcess);
    shutdownPromise = Promise.all([waitForExit(clientProcess), waitForExit(apiProcess)]).then(
      async () => {
        if (localSupabaseStartedByLauncher) {
          const result = spawnSync("pnpm", ["exec", "supabase", "stop"], {
            cwd: repositoryRoot,
            env: dockerEnvironment.env,
            encoding: "utf8",
            stdio: "ignore",
            windowsHide: true,
          });
          if (result.status !== 0)
            process.stderr.write("Could not stop the local Supabase services cleanly.\n");
        }
        if (dockerEnvironment.bridgeDirectory)
          await rm(dockerEnvironment.bridgeDirectory, { recursive: true, force: true });
      },
    );
    return shutdownPromise;
  };

  process.once("SIGINT", () => void shutdown(130));
  process.once("SIGTERM", () => void shutdown(143));
  process.once("SIGHUP", () => void shutdown(129));

  apiProcess = startProcess(
    dotnet,
    ["run", "--project", apiProject, "--no-launch-profile", "--urls", apiBindUrl],
    apiEnvironment,
    ".NET API",
  );
  apiProcess.once("exit", (code, signal) => {
    if (!stopping) void shutdown(code ?? (signal ? 1 : 0));
  });

  try {
    await waitForHealth(probeUrl, apiProcess);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    await shutdown(1);
    return;
  }

  if (stopping) return;
  try {
    prepareClient(mode, clientEnvironment);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    await shutdown(1);
    return;
  }
  process.stdout.write(
    "API is healthy. Starting client. Press Ctrl+C or close this terminal to stop both processes.\n",
  );
  clientProcess = startProcess(
    path.join(client.appDirectory, "node_modules", ".bin", client.executable),
    client.args,
    clientEnvironment,
    `${mode} client`,
    client.appDirectory,
  );
  clientProcess.once("exit", (code, signal) => {
    if (!stopping) void shutdown(code ?? (signal ? 1 : 0));
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
