import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "recall-tooling-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  const runner = join(root, "scripts/run-tooling.mjs");
  await copyFile(new URL("./run-tooling.mjs", import.meta.url), runner);
  return { root, runner };
}

function run(runner, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runner, process.execPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => resolve({ code: 1, output: error.message }));
    child.on("exit", (code) => resolve({ code, output }));
  });
}

await test(
  "independent heavy commands in one checkout cannot overlap",
  { timeout: 10_000 },
  async (context) => {
    const { root, runner } = await fixture(context);
    const job = join(root, "job.mjs");
    const marker = join(root, "running");
    await writeFile(
      job,
      `
    import { mkdir, rm, appendFile } from 'node:fs/promises';
    import { setTimeout } from 'node:timers/promises';
    await mkdir(process.argv[2]);
    await setTimeout(150);
    await rm(process.argv[2], { recursive: true });
    await appendFile(process.argv[3], 'completed\\n');
  `,
    );
    const results = await Promise.all(
      Array.from({ length: 3 }, () => run(runner, [job, marker, join(root, "result")])),
    );
    for (const result of results) assert.equal(result.code, 0, result.output);
    assert.equal((await readFile(join(root, "result"), "utf8")).trim().split("\n").length, 3);
    assert.ok(results.some((result) => result.output.includes("Waiting for")));
  },
);

await test(
  "nested commands reuse the slot and nonzero exits release it",
  { timeout: 10_000 },
  async (context) => {
    const { root, runner } = await fixture(context);
    const nested = join(root, "nested.mjs");
    await writeFile(
      nested,
      `
    import { spawnSync } from 'node:child_process';
    const result = spawnSync(process.execPath, [process.argv[2], process.execPath, '-e', 'process.exit(7)'], { stdio: 'inherit' });
    process.exitCode = result.status;
  `,
    );
    const failed = await run(runner, [nested, runner]);
    assert.equal(failed.code, 7, failed.output);
    const next = await run(runner, ["-e", "process.exit(0)"]);
    assert.equal(next.code, 0, next.output);
  },
);

await test(
  "a killed coordinator retains the slot until its child finishes",
  { timeout: 10_000 },
  async (context) => {
    if (process.platform === "win32") return context.skip("Requires POSIX signals");
    const { root, runner } = await fixture(context);
    const job = join(root, "held.mjs");
    const marker = join(root, "active");
    await writeFile(
      job,
      `
    import { mkdir, rm } from 'node:fs/promises';
    import { setTimeout } from 'node:timers/promises';
    await mkdir(process.argv[2]);
    await setTimeout(500);
    await rm(process.argv[2], { recursive: true });
  `,
    );
    const first = spawn(process.execPath, [runner, process.execPath, job, marker], {
      stdio: "ignore",
    });
    const { stat } = await import("node:fs/promises");
    const { setTimeout } = await import("node:timers/promises");
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await stat(marker).then(
          () => true,
          () => false,
        )
      )
        break;
      await setTimeout(10);
    }
    assert.ok(await stat(marker));
    first.kill("SIGKILL");
    const next = await run(runner, [job, marker]);
    assert.equal(next.code, 0, next.output);
  },
);
