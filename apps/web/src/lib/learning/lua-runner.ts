import "server-only";
import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { ActivityJsonSchema } from "@recall/domain";
import { LUA_RUNTIME_VERSION, type LuaTransportRequest } from "@recall/application";
import { runBoundedDockerCommand } from "./bounded-docker-command";
const resultSchema = Schema.Struct({
  ok: Schema.Boolean,
  version: Schema.Literal(LUA_RUNTIME_VERSION),
  value: Schema.optional(ActivityJsonSchema),
});
const failure = () =>
  ({
    _tag: "ActivityFailure",
    reason: "assessment-unavailable",
    message:
      "Lua execution failed or is unavailable. Check the script and runtime; your draft is preserved.",
  }) as const;
const slots = Effect.unsafeMakeSemaphore(2);
export function executeLuaInvocation(request: LuaTransportRequest) {
  const image = process.env.RECALL_LUA_IMAGE?.trim() || "recall-lua-runner:1";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,199}$/.test(image)) return Effect.fail(failure());
  const name = `recall-lua-${randomUUID()}`;
  return Effect.acquireUseRelease(
    Effect.succeed(name),
    () =>
      runBoundedDockerCommand(
        [
          "run",
          "--pull=never",
          "--rm",
          "--name",
          name,
          "-i",
          "--network=none",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--pids-limit=16",
          "--memory=128m",
          "--memory-swap=128m",
          "--cpus=0.5",
          "--user=65534:65534",
          "--ulimit=nofile=64:64",
          "--ulimit=cpu=5:5",
          image,
        ],
        JSON.stringify(request),
      ).pipe(
        Effect.timeoutFail({ duration: "5 seconds", onTimeout: failure }),
        Effect.flatMap(Schema.decodeUnknown(Schema.parseJson(resultSchema))),
        Effect.filterOrFail((result) => result.ok && result.value !== undefined, failure),
        Effect.map((result) => ({ value: result.value, runtimeVersion: result.version })),
        Effect.mapError(failure),
      ),
    () =>
      runBoundedDockerCommand(["rm", "-f", name]).pipe(Effect.timeout("5 seconds"), Effect.ignore),
  ).pipe(slots.withPermits(1));
}
