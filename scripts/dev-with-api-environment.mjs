import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

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

async function readEnvFile(repositoryRoot, relativePath) {
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

export {
  clientUrlFromBind,
  healthUrl,
  localSupabaseEnvironment,
  parseEnvText,
  readEnvFile,
  resolveSupabaseDockerEnvironment,
  startLocalSupabase,
};
