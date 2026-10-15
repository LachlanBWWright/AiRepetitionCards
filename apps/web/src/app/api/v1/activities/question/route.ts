import { randomUUID } from "node:crypto";
import { Effect, Either } from "effect";
import type { NextRequest } from "next/server";
import { readActivityRequest } from "@/lib/learning/activity-request";
import { createHostedTutorProvider, hostedTutorModel } from "@/lib/ai/openai";
import { reserveTutorCall, recordTutorUsage } from "@recall/infra-supabase/tutor-writes";
import { privateJson } from "@/lib/http/private-json";
export async function POST(request: NextRequest) {
  const parsed = await readActivityRequest(request);
  if (parsed.reply) return parsed.reply;
  const { activity, response, context, client, userId, presentation } = parsed.data;
  if (activity.pluginId !== "recall.interrogation")
    return privateJson(
      { error: "Only structured interrogations support adaptive follow-up questions." },
      { status: 400 },
    );
  if ((response.presentedPrompts?.length ?? presentation.prompts.length) >= 10)
    return privateJson(
      { error: "This interrogation has reached its ten-question limit." },
      { status: 400 },
    );
  const model = hostedTutorModel("question");
  const callId = randomUUID();
  const provider = createHostedTutorProvider(userId, callId, new Date());
  if (!process.env.OPENAI_API_KEY || !model || Either.isLeft(provider))
    return privateJson({ error: "AI follow-ups are unavailable." }, { status: 503 });
  const result = await Effect.runPromise(
    Effect.either(
      Effect.gen(function* () {
        if (!(yield* reserveTutorCall(client, callId, "question", model)))
          return yield* Effect.fail({ _tag: "ActivityQuotaExhausted" as const });
        const reply = yield* provider.right.generateQuestion(context);
        if (reply.inputTokens !== null && reply.outputTokens !== null)
          yield* recordTutorUsage(client, callId, reply.inputTokens, reply.outputTokens);
        return reply.result;
      }).pipe(
        Effect.timeoutFail({
          duration: "60 seconds",
          onTimeout: () => ({ _tag: "ActivityRequestTimeout" as const }),
        }),
      ),
    ),
  );
  if (Either.isLeft(result))
    return privateJson(
      {
        error:
          "_tag" in result.left && result.left._tag === "ActivityQuotaExhausted"
            ? "Today’s AI request limit has been reached. Your answers are retained."
            : "The follow-up could not be generated. Your answers are retained.",
      },
      { status: 503 },
    );
  if (!activity.objectiveIds.includes(result.right.objectiveId ?? ""))
    return privateJson(
      { error: "The suggested question did not match this objective." },
      { status: 502 },
    );
  if (!result.right.question.trim())
    return privateJson(
      { error: "The evaluator returned an empty follow-up question." },
      { status: 502 },
    );
  return privateJson({ question: result.right.question });
}
