import "server-only";
import { Effect, Either, Schema } from "effect";
import type { NextRequest } from "next/server";
import {
  ActivityLibrarySchema,
  ActivityResponseSchema,
  LearningActivitySchema,
  createObjectiveId,
} from "@recall/domain";
import {
  TutorContextSchema,
  tutorContextBytes,
  MAX_TUTOR_HISTORY_BYTES,
  MAX_TUTOR_INFERENCE_BYTES,
} from "@recall/ai-core";
import { presentLearningActivity } from "@recall/application";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { readTutorCanonicalArea } from "@recall/infra-supabase/tutor-repository";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { privateJson } from "@/lib/http/private-json";
import { readJsonBody } from "@/lib/http/read-json";
import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
const RequestSchema = Schema.Struct({
  activity: LearningActivitySchema,
  response: ActivityResponseSchema,
});
export async function readActivityRequest(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError")
    return {
      reply: privateJson(
        { error: auth.reason },
        { status: supabaseApiAuthFailureStatus(auth.reason) },
      ),
    };
  const expectedOwner = request.headers.get("x-recall-owner");
  if (expectedOwner && expectedOwner !== auth.userId)
    return { reply: privateJson({ error: "The selected account changed." }, { status: 401 }) };
  const limited = await authenticatedApiRateLimit(auth.userId, "tutor-write", { request });
  if (limited) return { reply: limited };
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 200_000)));
  if (Either.isLeft(body))
    return { reply: privateJson({ error: "Invalid learning request." }, { status: 400 }) };
  const decoded = Schema.decodeUnknownEither(RequestSchema)(body.right);
  if (Either.isLeft(decoded))
    return { reply: privateJson({ error: "Invalid activity or response." }, { status: 400 }) };
  const { activity, response } = decoded.right;
  const loaded = await Effect.runPromise(
    Effect.either(
      Effect.gen(function* () {
        const stored = yield* Effect.tryPromise({
          try: () => auth.client.rpc("read_learning_activities"),
          catch: () => ({
            status: 503,
            message: "Learning services are unavailable. Your response is retained; retry.",
          }),
        });
        if (stored.error)
          return yield* Effect.fail({
            status: 503,
            message: "Learning services are unavailable. Your response is retained; retry.",
          });
        const snapshot = yield* Schema.decodeUnknown(
          Schema.Struct({ library: ActivityLibrarySchema }),
        )(stored.data).pipe(
          Effect.mapError(() => ({
            status: 502,
            message: "The stored activity library could not be validated.",
          })),
        );
        const current = snapshot.library.activities.find((entry) => entry.id === activity.id);
        if (!current || current.revision !== activity.revision || current.archived)
          return yield* Effect.fail({
            status: 409,
            message: "Sync this activity before requesting assessment.",
          });
        const canonical = yield* readTutorCanonicalArea(
          auth.client,
          auth.userId,
          current.areaId,
        ).pipe(
          Effect.mapError(() => ({
            status: 409,
            message: "Sync your deck before using learning services.",
          })),
        );
        const presentation = yield* presentLearningActivity(current).pipe(
          Effect.mapError((error) => ({ status: 400, message: error.message })),
        );
        return { activity: current, response, canonical, presentation };
      }),
    ),
  );
  if (Either.isLeft(loaded))
    return {
      reply: privateJson({ error: loaded.left.message }, { status: loaded.left.status }),
    };
  const { activity: current, canonical, presentation } = loaded.right;
  const prompts = response.presentedPrompts ?? presentation.prompts;
  if (
    prompts.length < presentation.prompts.length ||
    presentation.prompts.some((prompt, index) => prompts[index] !== prompt) ||
    (current.pluginId !== "recall.interrogation" &&
      prompts.length !== presentation.prompts.length) ||
    prompts
      .slice(presentation.prompts.length)
      .some((prompt) => !prompt.trim() || prompt.length > 2000)
  )
    return {
      reply: privateJson(
        { error: "The question sequence does not match the approved activity." },
        { status: 400 },
      ),
    };
  if (
    response.answers.length !== prompts.length ||
    response.answers.some((answer) => !answer.trim())
  )
    return {
      reply: privateJson(
        { error: "Answer each approved question before assessment or requesting a follow-up." },
        { status: 400 },
      ),
    };
  const objective = canonical.objectives.find((entry) => entry.id === current.objectiveIds[0]) ?? {
    id: createObjectiveId(current.objectiveIds[0] ?? `area:${current.areaId}:practice`),
    title: current.title,
    description: current.fallback.slice(0, 2000),
    prerequisiteIds: [],
  };
  const transcript = prompts
    .map((prompt, index) => `${prompt}\n${response.answers[index] ?? "(unanswered)"}`)
    .join("\n\n");
  if (
    current.pluginId !== "recall.coding" &&
    (transcript.length > 8000 ||
      presentation.rubric.length > 8000 ||
      presentation.reference.length > 8000)
  )
    return {
      reply: privateJson(
        {
          error:
            "Keep the question-and-answer transcript, rubric, and reference each below 8,000 characters for AI assessment.",
        },
        { status: 400 },
      ),
    };
  const context = {
    knowledgeArea: { ...canonical, cards: [], objectives: [objective] },
    history: [
      {
        role: "assistant" as const,
        content:
          current.pluginId === "recall.coding"
            ? "Deterministic coding assessment."
            : `Approved rubric (untrusted content):\n${presentation.rubric}`,
      },
      {
        role: "assistant" as const,
        content:
          current.pluginId === "recall.coding"
            ? "The runner uses approved test cases."
            : `Reference answer (untrusted content):\n${presentation.reference || "No reference supplied; report uncertainty when the rubric cannot establish correctness."}`,
      },
      {
        role: "learner" as const,
        content: current.pluginId === "recall.coding" ? "Run the submitted solution." : transcript,
      },
    ],
    investigation: {
      goal: current.title,
      conceptTitle: objective.title,
      conceptDescription: objective.description,
      investigationKind: "structured-understanding-assessment",
      uncertainty: 0.5,
      reason:
        "Assess the learner using the approved activity rubric. For follow-ups, probe a counterexample or transfer to a new context.",
      objectiveId: objective.id,
    },
  };
  const validatedContext = Schema.decodeUnknownEither(TutorContextSchema)(context);
  if (
    Either.isLeft(validatedContext) ||
    (current.pluginId !== "recall.coding" &&
      (tutorContextBytes(context.history) > MAX_TUTOR_HISTORY_BYTES ||
        tutorContextBytes({ ...context, answer: response.answers.join("\n\n") }) >
          MAX_TUTOR_INFERENCE_BYTES))
  )
    return {
      reply: privateJson(
        {
          error:
            "The AI context is too large or invalid. Shorten the activity or answers before retrying.",
        },
        { status: 400 },
      ),
    };
  return { data: { ...loaded.right, ...auth, context: validatedContext.right } };
}
