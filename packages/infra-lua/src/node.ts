import { Effect } from "effect";
import { execute } from "../runtime/execute.mjs";
import { luaRuntimeVersion } from "./index.ts";
import type { LuaRuntime, LuaRuntimeFailure } from "./index.ts";

/** Fresh resource-limited worker and Lua state for each operation. */
export const createNodeLuaRuntime = (): LuaRuntime => ({
  version: luaRuntimeVersion,
  invoke: (request) =>
    Effect.tryPromise({
      try: () => execute(request),
      catch: (): LuaRuntimeFailure => ({
        code: "execution",
        message: "Lua worker could not start",
      }),
    }).pipe(
      Effect.flatMap((result) =>
        result.ok ? Effect.succeed(result.value) : Effect.fail(result.error),
      ),
    ),
});
