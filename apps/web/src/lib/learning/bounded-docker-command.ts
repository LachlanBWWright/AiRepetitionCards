import "server-only";
import { spawn } from "node:child_process";
import { Effect } from "effect";
import type { ActivityFailure } from "@recall/application";
const failure = (message: string): ActivityFailure => ({
  _tag: "ActivityFailure",
  reason: "assessment-unavailable",
  message,
});
export function runBoundedDockerCommand(
  args: readonly string[],
  input = "",
  limit = 65_536,
): Effect.Effect<string, ActivityFailure> {
  return Effect.tryPromise({
    try: (signal) =>
      new Promise<{ readonly ok: boolean; readonly output: string }>((resolve) => {
        const child = spawn("docker", [...args], { stdio: ["pipe", "pipe", "pipe"] });
        let output = "";
        let stderr = "";
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          signal.removeEventListener("abort", abort);
          resolve({ ok, output: ok ? output : stderr });
        };
        const abort = () => {
          child.kill("SIGKILL");
          finish(false);
        };
        signal.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", (chunk: unknown) => {
          if (done) return;
          if (Buffer.isBuffer(chunk)) {
            output += chunk.toString("utf8");
            if (Buffer.byteLength(output) > limit) abort();
          }
        });
        child.stderr.on("data", (chunk: unknown) => {
          if (Buffer.isBuffer(chunk)) stderr = (stderr + chunk.toString("utf8")).slice(0, 2000);
        });
        child.on("error", () => {
          finish(false);
        });
        child.on("close", (code) => {
          finish(code === 0);
        });
        child.stdin.on("error", () => {
          finish(false);
        });
        child.stdin.end(input);
      }),
    catch: () => failure("Code execution is unavailable. Your solution is retained."),
  }).pipe(
    Effect.flatMap((result) =>
      result.ok
        ? Effect.succeed(result.output)
        : Effect.fail(
            failure(
              "Code could not run within the resource limits. Check your solution or retry the runner.",
            ),
          ),
    ),
  );
}
