import { TutorActionResponseSchema, TutorApiResponseSchema } from "@recall/ai-core";
import type { TutorWorkflowSnapshot } from "@recall/application";
import {
  appendTutorMessage,
  appendTutorObservation,
  appendTutorProposal,
  createTutorSession,
  updateTutorSession,
  type TutorWriteError,
} from "@recall/infra-supabase/tutor-writes";
import { TutorMessageKind, TutorMessageRole } from "@recall/infra-supabase/tutor-repository";
import { toDatabaseJson } from "@recall/infra-supabase/json";
import { Effect, Either, Schema } from "effect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/http/private-json";
import { NextResponse } from "next/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface TutorAppendedMessage {
  readonly role: "assistant" | "learner";
  readonly content: string;
}

interface TutorTransition {
  readonly snapshot: TutorWorkflowSnapshot;
  readonly appendedHistory: readonly TutorAppendedMessage[];
  readonly response: typeof TutorActionResponseSchema.Type;
}

async function tutorWriteSucceeded(
  operation: Effect.Effect<unknown, TutorWriteError>,
): Promise<boolean> {
  return Either.isRight(await Effect.runPromise(Effect.either(operation)));
}

function unavailable(): NextResponse {
  return privateJson({ error: "tutor-storage-unavailable" }, { status: 502 });
}

export async function persistTutorTransition(
  client: SupabaseServerClient,
  userId: string,
  createsSession: boolean,
  observationId: string | null,
  transition: TutorTransition,
): Promise<NextResponse> {
  const { snapshot: next } = transition;
  const response =
    transition.response.action === "study-card" ||
    (transition.response.action === "question" && transition.response.result.proposal != null)
      ? { ...transition.response, providerResolutionRequired: false }
      : transition.response;
  const sessionId = response.sessionId;
  if (createsSession) {
    const snapshotJson = await Effect.runPromise(
      Effect.either(toDatabaseJson(next.context.knowledgeArea)),
    );
    if (Either.isLeft(snapshotJson) || snapshotJson.right === null) return unavailable();
    if (
      !(await tutorWriteSucceeded(
        createTutorSession(client, userId, {
          id: sessionId,
          area_id: next.context.knowledgeArea.id,
          area_title: next.context.knowledgeArea.title,
          area_snapshot: snapshotJson.right,
        }),
      ))
    )
      return unavailable();
  }
  for (const message of next.context.ephemeralSession ? [] : transition.appendedHistory) {
    if (
      !(await tutorWriteSucceeded(
        appendTutorMessage(client, userId, {
          id: crypto.randomUUID(),
          session_id: sessionId,
          role: message.role === "assistant" ? TutorMessageRole.Tutor : TutorMessageRole.Learner,
          kind:
            message.role === "learner"
              ? TutorMessageKind.Answer
              : response.action === "question" && !next.context.improvement
                ? TutorMessageKind.Question
                : TutorMessageKind.Feedback,
          content: message.content,
        }),
      ))
    )
      return unavailable();
  }
  if (response.action === "question") {
    if (
      !(await tutorWriteSucceeded(
        updateTutorSession(client, userId, sessionId, {
          updated_at: new Date().toISOString(),
          last_observation_id: null,
          last_proposal_id: null,
          last_quiz: null,
        }),
      ))
    )
      return unavailable();
  } else if (response.action === "targeted-quiz") {
    const quizJson = await Effect.runPromise(Effect.either(toDatabaseJson(next.state.quiz)));
    if (Either.isLeft(quizJson) || quizJson.right === null) return unavailable();
    if (
      !(await tutorWriteSucceeded(
        updateTutorSession(client, userId, sessionId, {
          updated_at: new Date().toISOString(),
          last_quiz: quizJson.right,
          last_observation_id: null,
          last_proposal_id: null,
        }),
      ))
    )
      return unavailable();
  } else if (response.action === "evaluate" || response.action === "evaluate-quiz-answer") {
    const payload = await Effect.runPromise(Effect.either(toDatabaseJson(response.result)));
    const quizJson = await Effect.runPromise(Effect.either(toDatabaseJson(next.state.quiz)));
    if (Either.isLeft(payload) || payload.right === null || Either.isLeft(quizJson))
      return unavailable();
    const newObservationId = crypto.randomUUID();
    if (
      !(await tutorWriteSucceeded(
        appendTutorObservation(client, userId, {
          id: newObservationId,
          session_id: sessionId,
          objective_id: response.result.objectiveId,
          result: response.result.result,
          confidence: response.result.confidence,
          misconception: response.result.misconception,
          evidence_summary: response.result.feedback,
          suggested_action: response.result.suggestedAction,
          payload: payload.right,
        }),
      ))
    )
      return unavailable();
    if (
      !(await tutorWriteSucceeded(
        updateTutorSession(client, userId, sessionId, {
          updated_at: new Date().toISOString(),
          last_observation_id: newObservationId,
          last_proposal_id: null,
          last_quiz: quizJson.right,
        }),
      ))
    )
      return unavailable();
  } else if (
    response.action === "study-card" ||
    response.action === "refine-card" ||
    response.action === "inspect-card" ||
    response.action === "plan-study"
  ) {
    // Source proposals are approved locally. Existing SQL proposals require learner
    // observations, which source extraction must never fabricate.
  } else {
    if (!observationId) return unavailable();
    const content = await Effect.runPromise(Effect.either(toDatabaseJson(response.result)));
    if (Either.isLeft(content) || content.right === null) return unavailable();
    if (
      !(await tutorWriteSucceeded(
        appendTutorProposal(client, userId, {
          id: response.proposalId,
          session_id: sessionId,
          observation_id: observationId,
          content: content.right,
          state: "pending",
        }),
      )) ||
      !(await tutorWriteSucceeded(
        updateTutorSession(client, userId, sessionId, {
          last_proposal_id: response.proposalId,
          updated_at: new Date().toISOString(),
        }),
      )) ||
      !(await tutorWriteSucceeded(
        appendTutorMessage(client, userId, {
          id: crypto.randomUUID(),
          session_id: sessionId,
          role: TutorMessageRole.Tutor,
          kind: TutorMessageKind.Proposal,
          content: response.result.front,
        }),
      ))
    )
      return unavailable();
  }
  const validated = Schema.decodeUnknownEither(TutorActionResponseSchema)(response);
  if (Either.isLeft(validated))
    return privateJson({ error: "invalid-provider-response" }, { status: 502 });
  const apiResponse = Schema.decodeUnknownEither(TutorApiResponseSchema)({
    schemaVersion: 1,
    response: validated.right,
  });
  return Either.isLeft(apiResponse)
    ? privateJson({ error: "invalid-provider-response" }, { status: 502 })
    : privateJson(apiResponse.right);
}
