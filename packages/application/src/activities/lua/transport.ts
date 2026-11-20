import { Effect, Schema } from "effect";
import { ActivityJsonSchema } from "@recall/domain";
import type { ActivityHttpTransport } from "../activity-services";
import { failure, type ActivityFailure } from "../learning-activities-plugins";
import type { LuaRuntime } from "./contracts";

export const LUA_RUNTIME_VERSION = "recall-lua-wasmoon-1.16.0-v1";
export type LuaTransportRequest = Parameters<LuaRuntime["invoke"]>[0];
export type LuaTransport = (
  request: LuaTransportRequest,
) => Effect.Effect<unknown, ActivityFailure>;
export function createOnlineLuaRuntime(
  post: LuaTransport,
  version = LUA_RUNTIME_VERSION,
): LuaRuntime {
  return {
    version,
    invoke: (request) =>
      post(request).pipe(
        Effect.flatMap((raw) =>
          Schema.decodeUnknown(ActivityJsonSchema)(raw).pipe(
            Effect.mapError(() =>
              failure(
                "assessment-unavailable",
                "The Lua service returned invalid JSON. Your draft is preserved.",
              ),
            ),
          ),
        ),
      ),
  };
}
const replySchema = Schema.Struct({ value: ActivityJsonSchema, runtimeVersion: Schema.String });
/** Uses the existing authenticated web/native transport; never passes auth to Lua. */
export function createLuaHttpRuntime(
  transport: ActivityHttpTransport,
  version = LUA_RUNTIME_VERSION,
): LuaRuntime {
  return createOnlineLuaRuntime(
    (request) =>
      transport({
        path: "/api/v1/activities/lua",
        method: "POST",
        body: request,
      }).pipe(
        Effect.flatMap((reply) => {
          if (reply.status !== 200) {
            const body = reply.body;
            const message =
              typeof body === "object" &&
              body !== null &&
              "error" in body &&
              typeof body.error === "string"
                ? body.error
                : "Lua execution is unavailable. Your draft is preserved; use the fallback activity.";
            return Effect.fail(
              failure(reply.status === 400 ? "invalid-input" : "assessment-unavailable", message),
            );
          }
          return Schema.decodeUnknown(replySchema)(reply.body).pipe(
            Effect.mapError(() =>
              failure("assessment-unavailable", "The Lua service returned an invalid response."),
            ),
            Effect.filterOrFail(
              (body) => body.runtimeVersion === version,
              () => failure("conflict", "Lua runtime version changed. Your draft is preserved."),
            ),
            Effect.map((body) => body.value),
          );
        }),
      ),
    version,
  );
}
/** Structural adapter keeps infrastructure dependencies out of application code. */
export function adaptLuaRuntime<E extends { readonly message: string }>(runtime: {
  readonly version: string;
  readonly invoke: (request: LuaTransportRequest) => Effect.Effect<unknown, E>;
}): LuaRuntime {
  return {
    version: runtime.version,
    invoke: (request) =>
      runtime
        .invoke(request)
        .pipe(Effect.mapError((error) => failure("assessment-unavailable", error.message))),
  };
}
