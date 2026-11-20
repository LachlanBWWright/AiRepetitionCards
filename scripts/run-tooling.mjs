import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const repository = fileURLToPath(new URL("../", import.meta.url));
const key = createHash("sha256").update(repository).digest("hex").slice(0, 16);
const lock = join(tmpdir(), `recall-tooling-${key}`);
const ownerPath = join(lock, "owner.json");
const [command, ...args] = process.argv.slice(2);

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function owner() {
  try {
    const value = JSON.parse(await readFile(ownerPath, "utf8"));
    return Number.isSafeInteger(value.pid) && value.pid > 0 ? value : null;
  } catch {
    return null;
  }
}

function workloadAlive(holder) {
  return alive(holder.pid) || (Number.isSafeInteger(holder.childPid) && alive(holder.childPid));
}

async function acquire() {
  // Child commands may call another root script; they already share the parent's slot.
  const inherited = Number(process.env.RECALL_TOOLING_OWNER_PID);
  const current = await owner();
  if (current?.pid === inherited && alive(inherited)) return false;
  let announced = false;
  while (true) {
    try {
      await mkdir(lock);
      try {
        await writeFile(ownerPath, JSON.stringify({ pid: process.pid, command }));
      } catch (error) {
        await rm(lock, { recursive: true, force: true });
        return Promise.reject(error);
      }
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") return Promise.reject(error);
      const holder = await owner();
      const age = Date.now() - (await stat(lock).catch(() => null))?.mtimeMs;
      if ((holder && !workloadAlive(holder)) || (!holder && age > 5_000)) {
        const reaper = `${lock}.reap`;
        const acquiredReaper = await mkdir(reaper).then(
          () => true,
          () => false,
        );
        if (acquiredReaper) {
          try {
            const latest = await owner();
            const latestAge = Date.now() - (await stat(lock).catch(() => null))?.mtimeMs;
            if ((latest && !workloadAlive(latest)) || (!latest && latestAge > 5_000))
              await rm(lock, { recursive: true, force: true });
          } finally {
            await rm(reaper, { recursive: true, force: true });
          }
        }
        continue;
      }
      if (!announced) {
        process.stdout.write("Waiting for this checkout's other tooling command to finish…\n");
        announced = true;
      }
      await delay(250);
    }
  }
}

async function run() {
  if (!command) {
    process.stderr.write("Usage: node scripts/run-tooling.mjs <command> [args...]\n");
    return 1;
  }
  const acquired = await acquire();
  const windows = process.platform === "win32";
  let child;
  let recorded = Promise.resolve();
  const stop = (signal) => {
    if (!child?.pid) return;
    if (windows) child.kill(signal);
    else {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The process group may already have exited.
      }
    }
  };
  const interrupt = () => stop("SIGINT");
  const terminate = () => stop("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await new Promise((resolve) => {
      child = spawn(command, args, {
        stdio: "inherit",
        shell: windows,
        detached: !windows,
        env: {
          ...process.env,
          RECALL_TOOLING_OWNER_PID: acquired
            ? String(process.pid)
            : process.env.RECALL_TOOLING_OWNER_PID,
        },
      });
      if (acquired && child.pid) {
        recorded = writeFile(
          ownerPath,
          JSON.stringify({ pid: process.pid, childPid: child.pid, command }),
        );
        recorded.catch(() => stop("SIGTERM"));
      }
      child.once("error", (error) => {
        process.stderr.write(`${error.message}\n`);
        resolve(1);
      });
      child.once("exit", (code, signal) => resolve(code ?? (signal === "SIGINT" ? 130 : 1)));
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    await recorded.catch(() => undefined);
    if (acquired) await rm(lock, { recursive: true, force: true });
  }
}

run().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`Tooling coordinator failed: ${error.message}\n`);
    process.exitCode = 1;
  },
);
