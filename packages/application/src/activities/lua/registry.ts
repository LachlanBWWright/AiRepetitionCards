import { Effect } from "effect";
import {
  builtinActivityRegistry,
  type ActivityRegistry,
  type ActivityPlugin,
} from "../learning-activities-plugins";
import { decodeLuaPayload, type LuaRuntime } from "./contracts";
import { assessLuaActivity } from "./workflow";

export function createLuaActivityPlugin(runtime: LuaRuntime): ActivityPlugin {
  return {
    id: "recall.lua",
    version: 1,
    label: "Lua activity",
    capabilities: {
      offline: false,
      execution: true,
      assessment: "deterministic",
      platforms: ["web", "native"],
    },
    present: (input) =>
      decodeLuaPayload(input).pipe(
        Effect.map(() => ({
          prompts: ["Complete the host-rendered Lua activity, then request assessment."],
          options: [],
          rubric: "A completed script assessment is a proposal until you accept it.",
          reference: "",
          code: false,
        })),
      ),
    assess: (activity, response) =>
      decodeLuaPayload(activity.payload).pipe(
        Effect.flatMap((payload) => assessLuaActivity(payload, response, runtime)),
        Effect.map((assessment) => ({
          evaluatorId: "recall.lua:isolated",
          evaluatorVersion: runtime.version,
          feedback: assessment.feedback,
          evidence: activity.objectiveIds.map((objectiveId) => ({
            objectiveId,
            dimension: "application" as const,
            score: assessment.score,
            confidence: 0.7,
            assistance: response.assistance,
            assessment: "deterministic" as const,
            explanation:
              "Completed Lua assessment replayed by the isolated runtime; no scheduling action was performed.",
          })),
        })),
      ),
  };
}
export function createLuaActivityRegistry(
  runtime: LuaRuntime,
  base: ActivityRegistry = builtinActivityRegistry,
): ActivityRegistry {
  return [...base.filter((plugin) => plugin.id !== "recall.lua"), createLuaActivityPlugin(runtime)];
}
