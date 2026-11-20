import { Effect } from "effect";

export const luaRuntimeVersion = "recall-lua-wasmoon-1.16.0-v1";
export interface LuaRuntimeRequest {
  readonly script: string;
  readonly configuration: unknown;
  readonly seed: number;
  readonly operation: "init" | "view" | "update" | "assess";
  readonly state?: unknown;
  readonly event?: unknown;
}
export interface LuaRuntimeFailure {
  readonly code: "unavailable" | "invalid-request" | "budget" | "execution";
  readonly message: string;
}
export interface LuaRuntime {
  readonly version: string;
  readonly invoke: (request: LuaRuntimeRequest) => Effect.Effect<unknown, LuaRuntimeFailure>;
}
export const createUnavailableLuaRuntime = (
  message = "Isolated Lua execution requires the online runtime on this platform.",
): LuaRuntime => ({
  version: luaRuntimeVersion,
  invoke: () => Effect.fail({ code: "unavailable", message }),
});
