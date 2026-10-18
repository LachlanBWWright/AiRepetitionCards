import {
  AnswerEvaluationSchema,
  CardProposalSchema,
  TargetedQuizSessionSchema,
  TutorSessionStateResponseSchema,
  TutorSessionStateSchema,
} from "@recall/ai-core";
import type { TutorWorkflowSnapshot } from "@recall/application";
import {
  readTutorObservationHistory,
  readTutorObservationPayload,
  readTutorProposal,
} from "@recall/infra-supabase/tutor-repository";
import { Effect, Either, Schema } from "effect";
import { NextResponse } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface TutorSessionForState {
  readonly context: TutorWorkflowSnapshot["context"];
  readonly session: {
    readonly last_observation_id: string | null;
    readonly last_proposal_id: string | null;
    readonly last_quiz: unknown;
  };
}

function unavailable(): NextResponse {
  return privateJson({ error: "tutor-storage-unavailable" }, { status: 502 });
}

export async function buildTutorSessionStateResponse(
  client: SupabaseServerClient,
  userId: string,
  sessionId: string,
  session: TutorSessionForState,
): Promise<NextResponse> {
  const observations = await Effect.runPromise(
    Effect.either(readTutorObservationHistory(client, userId, sessionId)),
  );
  if (Either.isLeft(observations)) return unavailable();

  let evaluation: typeof AnswerEvaluationSchema.Type | null = null;
  const observationId = session.session.last_observation_id;
  if (observationId) {
    const result = await Effect.runPromise(
      Effect.either(readTutorObservationPayload(client, userId, observationId)),
    );
    if (Either.isLeft(result)) return unavailable();
    const decoded = Schema.decodeUnknownEither(AnswerEvaluationSchema)(result.right);
    if (Either.isLeft(decoded)) return unavailable();
    evaluation = decoded.right;
  }

  let proposal: {
    readonly proposalId: string;
    readonly content: typeof CardProposalSchema.Type;
  } | null = null;
  const proposalId = session.session.last_proposal_id;
  if (proposalId) {
    const result = await Effect.runPromise(
      Effect.either(readTutorProposal(client, userId, proposalId)),
    );
    if (Either.isLeft(result)) return unavailable();
    if (result.right.state === "pending") {
      const content = Schema.decodeUnknownEither(CardProposalSchema)(result.right.content);
      if (Either.isLeft(content)) return unavailable();
      proposal = { proposalId, content: content.right };
    }
  }

  let quiz: typeof TargetedQuizSessionSchema.Type | null = null;
  if (session.session.last_quiz !== null) {
    const decodedQuiz = Schema.decodeUnknownEither(TargetedQuizSessionSchema)(
      session.session.last_quiz,
    );
    if (Either.isLeft(decodedQuiz)) return unavailable();
    quiz = decodedQuiz.right;
  }
  const state = Schema.decodeUnknownEither(TutorSessionStateSchema)({
    sessionId,
    history: session.context.history,
    evaluation,
    observations: observations.right,
    proposal,
    quiz,
  });
  if (Either.isLeft(state)) return privateJson({ error: "tutor-state-invalid" }, { status: 502 });
  const response = Schema.decodeUnknownEither(TutorSessionStateResponseSchema)({
    schemaVersion: 1,
    state: state.right,
  });
  return Either.isLeft(response)
    ? privateJson({ error: "tutor-state-invalid" }, { status: 502 })
    : privateJson(response.right);
}
