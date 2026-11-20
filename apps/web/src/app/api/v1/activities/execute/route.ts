import { Effect, Either } from "effect";
import type { NextRequest } from "next/server";
import { readActivityRequest } from "@/lib/learning/activity-request";
import { executeCodingActivity } from "@/lib/learning/code-runner";
import { privateJson } from "@/lib/http/private-json";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const parsed = await readActivityRequest(request);
  if (parsed.reply) return parsed.reply;
  const { activity, response, executionMode } = parsed.data;
  if (activity.pluginId !== "recall.coding")
    return privateJson({ error: "This runner only executes coding activities." }, { status: 400 });
  const executed = await Effect.runPromise(
    Effect.either(executeCodingActivity(activity, response, executionMode)),
  );
  return Either.isLeft(executed)
    ? privateJson({ error: executed.left.message }, { status: 503 })
    : privateJson(executed.right);
}
