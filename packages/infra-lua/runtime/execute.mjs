import { Worker } from "node:worker_threads";
export const version = "recall-lua-wasmoon-1.16.0-v1";
const fail = (code, message) => ({ ok: false, error: { code, message } });
function validJson(value, depth = 0) {
  if (depth > 16) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  return Object.values(value).every((child) => validJson(child, depth + 1));
}
export function execute(request) {
  if (
    !request ||
    typeof request !== "object" ||
    typeof request.script !== "string" ||
    Buffer.byteLength(request.script) > 32768 ||
    !["init", "view", "update", "assess"].includes(request.operation) ||
    !Number.isInteger(request.seed) ||
    request.seed < 0 ||
    request.seed > 4294967295 ||
    !validJson(request) ||
    Buffer.byteLength(JSON.stringify(request)) > 65536
  )
    return Promise.resolve(fail("invalid-request", "Invalid or oversized Lua request"));
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
      execArgv: [],
    });
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve({ ...result, version });
    };
    const timer = setTimeout(() => finish(fail("budget", "Lua wall time budget exceeded")), 1500);
    worker.once("message", finish);
    worker.once("error", () => finish(fail("execution", "Lua worker failed")));
    worker.once("exit", () => finish(fail("execution", "Lua worker exited without result")));
  });
}
