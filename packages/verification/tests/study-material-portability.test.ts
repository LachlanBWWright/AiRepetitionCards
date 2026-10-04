import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

void test("browser-target material parser executes without Node globals", async () => {
  await promisify(execFile)(process.execPath, ["scripts/verify-study-material-runtime.mjs"], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
});
