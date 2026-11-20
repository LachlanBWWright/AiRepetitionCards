import { Effect, Schema } from "effect";
import { ActivityJsonSchema } from "@recall/domain";
import { failure } from "../learning-activities-plugins";
import { decodeLuaPayload } from "./contracts";

export const initialLuaScript = `return {
  init = function(config, seed) return { count = 0 } end,
  view = function(state)
    return { text = "Count to three: " .. state.count,
      buttons = {{ id = "increment", label = "Add one" }} }
  end,
  update = function(state, event)
    if event.id == "increment" then state.count = state.count + 1 end
    return state
  end,
  assess = function(state)
    return { complete = state.count >= 3, score = state.count == 3 and 1 or 0,
      feedback = "Aim for exactly three." }
  end
}`;
export const luaAuthoringFields = [
  {
    key: "script",
    label: "Lua script (return init, view, update, assess functions)",
    initial: initialLuaScript,
    multiline: true,
  },
  { key: "configuration", label: "Configuration (JSON object)", initial: "{}", multiline: true },
  { key: "seed", label: "Deterministic seed", initial: "0", multiline: false },
  {
    key: "fallback",
    label: "Fallback activity (required when runtime is unavailable)",
    initial: "Count to three and explain each step.",
    multiline: true,
  },
] as const;
export type LuaAuthoringValues = Readonly<Record<string, string>>;
export function buildLuaAuthoringPayload(input: LuaAuthoringValues) {
  const fields: LuaAuthoringValues = {
    ...Object.fromEntries(luaAuthoringFields.map((field) => [field.key, field.initial])),
    ...input,
  };
  return Effect.gen(function* () {
    if (!(fields.fallback ?? "").trim())
      return yield* Effect.fail(failure("invalid-input", "Provide an explicit fallback activity."));
    const configuration = yield* Schema.decodeUnknown(Schema.parseJson(ActivityJsonSchema))(
      fields.configuration ?? "{}",
    ).pipe(
      Effect.mapError(() =>
        failure("invalid-input", "Configuration must be a bounded JSON object."),
      ),
    );
    return yield* decodeLuaPayload({
      script: fields.script ?? "",
      configuration,
      seed: Number(fields.seed ?? "0"),
    });
  });
}
