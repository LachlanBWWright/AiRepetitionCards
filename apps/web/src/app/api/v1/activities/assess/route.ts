import { randomUUID } from "node:crypto";
import { Effect, Either, Schema } from "effect";
import { ActivityResultSchema } from "@recall/domain";
import type { NextRequest } from "next/server";
import { readActivityRequest } from "@/lib/learning/activity-request";
import { executeCodingActivity } from "@/lib/learning/code-runner";
import { createHostedTutorProvider, hostedTutorModel } from "@/lib/ai/openai";
import { reserveTutorCall, recordTutorUsage } from "@recall/infra-supabase/tutor-writes";
import { privateJson } from "@/lib/http/private-json";
export const runtime = "nodejs";
function assessedReply(input: unknown) {
  const result = Schema.decodeUnknownEither(ActivityResultSchema)(input);
  return Either.isRight(result)
    ? privateJson(result.right)
    : privateJson(
        { error: "The evaluator returned an invalid assessment. Your response is retained." },
        { status: 502 },
      );
}
export async function POST(request: NextRequest) {
  const parsed = await readActivityRequest(request);
  if (parsed.reply) return parsed.reply;
  const { activity, response, context, client, userId } = parsed.data;
  if (activity.pluginId === "recall.coding") {
    const executed = await Effect.runPromise(
      Effect.either(executeCodingActivity(activity, response)),
    );
    if (Either.isLeft(executed))
      return privateJson({ error: executed.left.message }, { status: 503 });
    const result = executed.right;
    return assessedReply({
      evaluatorId: "recall.coding:javascript-tests",
      evaluatorVersion: "docker-vm-1",
      feedback: `${String(result.passed)}/${String(result.total)} tests passed. ${result.failures.join(" ")} Tests establish correctness against these examples, not algorithmic complexity.`,
      evidence: activity.objectiveIds.map((objectiveId) => ({
        objectiveId,
        dimension: "application",
        score: result.passed / result.total,
        confidence: 0.9,
        assistance: response.assistance,
        assessment: "deterministic",
        explanation:
          "Bounded, isolated JavaScript execution against the activity's approved test cases.",
      })),
    });
  }
  if (
    !["recall.short-answer", "recall.interrogation", "recall.basic", "recall.cloze"].includes(
      activity.pluginId,
    )
  )
    return privateJson(
      { error: "This activity uses its own deterministic evaluator." },
      { status: 400 },
    );
  const model = hostedTutorModel("evaluate");
  const callId = randomUUID();
  const provider = createHostedTutorProvider(userId, callId, new Date());
  if (!process.env.OPENAI_API_KEY || !model || Either.isLeft(provider))
    return privateJson({ error: "AI assessment is unavailable." }, { status: 503 });
  const result = await Effect.runPromise(
    Effect.either(
      Effect.gen(function* () {
        const admitted = yield* reserveTutorCall(client, callId, "evaluate", model);
        if (!admitted) return yield* Effect.fail({ _tag: "ActivityQuotaExhausted" as const });
        const reply = yield* provider.right.evaluateAnswer({
          ...context,
          answer: response.answers.join("\n\n"),
        });
        if (reply.inputTokens !== null && reply.outputTokens !== null)
          yield* recordTutorUsage(client, callId, reply.inputTokens, reply.outputTokens);
        return reply;
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
            ? "Today’s AI request limit has been reached. Your response is retained."
            : "AI assessment could not complete. Your response is retained; retry.",
      },
      { status: 503 },
    );
  const evaluation = result.right.result;
  if (evaluation.result === "uncertain")
    return privateJson(
      {
        error:
          "The evaluator could not assess this reliably. Revise the rubric or use self-assessment.",
      },
      { status: 422 },
    );
  const objectiveId = activity.objectiveIds.find((id) => id === evaluation.objectiveId);
  if (!objectiveId)
    return privateJson(
      { error: "The evaluation did not match this activity's objective." },
      { status: 502 },
    );
  return assessedReply({
    evaluatorId: "recall.ai:rubric",
    evaluatorVersion: model,
    feedback: evaluation.feedback,
    evidence: [
      {
        objectiveId,
        dimension:
          activity.pluginId === "recall.basic" || activity.pluginId === "recall.cloze"
            ? "recall"
            : "reasoning",
        score: evaluation.result === "mastered" ? 1 : evaluation.result === "partial" ? 0.5 : 0,
        confidence: evaluation.confidence,
        assistance: response.assistance,
        assessment: "ai",
        explanation: evaluation.misconception?.trim() || evaluation.feedback,
      },
    ],
  });
}
