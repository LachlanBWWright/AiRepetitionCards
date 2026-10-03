import { Effect, Either, Schema } from "effect";
import {
  MAX_TUTOR_SESSION_OBSERVATIONS,
  MAX_TUTOR_CONTEXT_MESSAGES,
  selectTutorContextHistory,
  TutorContextSchema,
  TutorObservationHistorySchema,
  type AnswerEvaluation,
} from "@recall/ai-core";
import type { RecallSupabaseClient } from "./client";

const StoredSessionSchema = Schema.Struct({
  id: Schema.String,
  area_id: Schema.String,
  area_snapshot: Schema.Unknown,
  last_quiz: Schema.Unknown,
  last_observation_id: Schema.NullOr(Schema.String),
  last_proposal_id: Schema.NullOr(Schema.String),
});
const StoredMessageSchema = Schema.Struct({
  role: Schema.String,
  kind: Schema.String,
  content: Schema.Unknown,
});
const ObservationPayloadRowSchema = Schema.Struct({ payload: Schema.Unknown });
const ObservationIdRowSchema = Schema.Struct({ id: Schema.String });
const ProposalRowSchema = Schema.Struct({
  id: Schema.String,
  content: Schema.Unknown,
  state: Schema.String,
  approved_card_id: Schema.NullOr(Schema.String),
});

export type LoadedTutorSession = {
  readonly session: typeof StoredSessionSchema.Type;
  readonly context: typeof TutorContextSchema.Type;
  readonly pendingQuestion: boolean;
};

export type TutorSessionRepositoryError =
  | { readonly _tag: "TutorSessionNotFound" }
  | { readonly _tag: "TutorSessionRepositoryUnavailable" };

export type TutorReadRepositoryError =
  { readonly _tag: "TutorReadRepositoryUnavailable" } | { readonly _tag: "TutorReadNotFound" };

/** Read a full canonical area for a compact initial tutor transport, with explicit ownership. */
export function readTutorCanonicalArea(
  client: RecallSupabaseClient,
  userId: string,
  areaId: string,
) {
  return Effect.gen(function* () {
    yield* readRow(
      Schema.Struct({ id: Schema.String }),
      client
        .from("knowledge_areas")
        .select("id")
        .eq("id", areaId)
        .eq("owner_id", userId)
        .is("deleted_at", null)
        .maybeSingle(),
    );
    const row = yield* readRow(
      Schema.Struct({ content: TutorContextSchema.fields.knowledgeArea }),
      client
        .from("knowledge_area_versions")
        .select("content")
        .eq("knowledge_area_id", areaId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    if (row.content.id !== areaId)
      return yield* Effect.fail({ _tag: "TutorReadRepositoryUnavailable" } as const);
    return row.content;
  });
}

function readRow<A, I>(
  schema: Schema.Schema<A, I>,
  query: PromiseLike<{ readonly data: unknown; readonly error: unknown }>,
): Effect.Effect<A, TutorReadRepositoryError> {
  type ReadResult =
    | { readonly _tag: "ReadFailure" }
    | { readonly _tag: "ReadNotFound" }
    | { readonly _tag: "ReadSuccess"; readonly value: A };
  const operation: Effect.Effect<ReadResult, TutorReadRepositoryError> = Effect.tryPromise({
    try: async (): Promise<ReadResult> => {
      const result = await query;
      if (result.error !== null) return { _tag: "ReadFailure" } as const;
      if (result.data === null) return { _tag: "ReadNotFound" } as const;
      const decoded = Schema.decodeUnknownEither(schema)(result.data);
      return Either.isLeft(decoded)
        ? ({ _tag: "ReadFailure" } as const)
        : ({ _tag: "ReadSuccess", value: decoded.right } as const);
    },
    catch: (): TutorReadRepositoryError => ({ _tag: "TutorReadRepositoryUnavailable" }),
  });
  return operation.pipe(
    Effect.flatMap((result): Effect.Effect<A, TutorReadRepositoryError> =>
      result._tag === "ReadSuccess"
        ? Effect.succeed(result.value)
        : result._tag === "ReadNotFound"
          ? Effect.fail({ _tag: "TutorReadNotFound" } as const)
          : Effect.fail({ _tag: "TutorReadRepositoryUnavailable" } as const),
    ),
  );
}

export type TutorObservationHistoryReadError =
  TutorReadRepositoryError | { readonly _tag: "TutorObservationHistoryInvalid" };

/** Read the most recent bounded, owner-scoped evidence in deterministic chronological order. */
export function readTutorObservationHistory(
  client: RecallSupabaseClient,
  userId: string,
  sessionId: string,
): Effect.Effect<readonly AnswerEvaluation[], TutorObservationHistoryReadError> {
  return readRow(
    Schema.Array(ObservationPayloadRowSchema).pipe(Schema.maxItems(MAX_TUTOR_SESSION_OBSERVATIONS)),
    client
      .from("ai_observations")
      .select("payload")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_TUTOR_SESSION_OBSERVATIONS),
  ).pipe(
    Effect.flatMap((rows) =>
      Schema.decodeUnknown(TutorObservationHistorySchema)(
        [...rows].reverse().map((row) => row.payload),
      ).pipe(Effect.mapError(() => ({ _tag: "TutorObservationHistoryInvalid" }) as const)),
    ),
  );
}

/** Read the newest owner-scoped observation payload for a tutor session. */
export function readLatestTutorObservationPayload(
  client: RecallSupabaseClient,
  userId: string,
  sessionId: string,
): Effect.Effect<unknown, TutorReadRepositoryError> {
  return readRow(
    ObservationPayloadRowSchema,
    client
      .from("ai_observations")
      .select("payload")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ).pipe(Effect.map((row) => row.payload));
}

/** Read the newest owner-scoped observation identifier for a tutor session. */
export function readLatestTutorObservationId(
  client: RecallSupabaseClient,
  userId: string,
  sessionId: string,
): Effect.Effect<string, TutorReadRepositoryError> {
  return readRow(
    ObservationIdRowSchema,
    client
      .from("ai_observations")
      .select("id")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ).pipe(Effect.map((row) => row.id));
}

/** Read an owner-scoped observation by its persisted session reference. */
export function readTutorObservationPayload(
  client: RecallSupabaseClient,
  userId: string,
  observationId: string,
): Effect.Effect<unknown, TutorReadRepositoryError> {
  return readRow(
    ObservationPayloadRowSchema,
    client
      .from("ai_observations")
      .select("payload")
      .eq("id", observationId)
      .eq("user_id", userId)
      .maybeSingle(),
  ).pipe(Effect.map((row) => row.payload));
}

/** Read an owner-scoped proposal by its persisted session reference. */
export function readTutorProposal(
  client: RecallSupabaseClient,
  userId: string,
  proposalId: string,
): Effect.Effect<typeof ProposalRowSchema.Type, TutorReadRepositoryError> {
  return readRow(
    ProposalRowSchema,
    client
      .from("generated_card_proposals")
      .select("id, content, state, approved_card_id")
      .eq("id", proposalId)
      .eq("user_id", userId)
      .maybeSingle(),
  );
}

/** Load an owner-scoped tutor session and decode the recent inference window at the boundary. */
export function loadTutorSession(
  client: RecallSupabaseClient,
  userId: string,
  sessionId: string,
): Effect.Effect<LoadedTutorSession, TutorSessionRepositoryError> {
  return Effect.tryPromise({
    try: async (): Promise<LoadedTutorSession | TutorSessionRepositoryError> => {
      const found = await client
        .from("tutor_sessions")
        .select("id, area_id, area_snapshot, last_observation_id, last_proposal_id, last_quiz")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (found.error) return { _tag: "TutorSessionRepositoryUnavailable" };
      if (!found.data) return { _tag: "TutorSessionNotFound" };
      const session = Schema.decodeUnknownEither(StoredSessionSchema)(found.data);
      if (Either.isLeft(session)) return { _tag: "TutorSessionRepositoryUnavailable" };

      const messageResult = await client
        .from("tutor_messages")
        .select("role, kind, content")
        .eq("session_id", sessionId)
        .eq("user_id", userId)
        .in("kind", ["question", "answer", "feedback"])
        .in("role", ["tutor", "learner"])
        .order("sequence", { ascending: false })
        .order("id", { ascending: false })
        .limit(MAX_TUTOR_CONTEXT_MESSAGES);
      if (messageResult.error) return { _tag: "TutorSessionRepositoryUnavailable" };
      const messages = Schema.decodeUnknownEither(
        Schema.Array(StoredMessageSchema).pipe(Schema.maxItems(MAX_TUTOR_CONTEXT_MESSAGES)),
      )(messageResult.data);
      if (Either.isLeft(messages)) return { _tag: "TutorSessionRepositoryUnavailable" };

      const history: Array<{ role: "assistant" | "learner"; content: string }> = [];
      for (const message of [...messages.right].reverse()) {
        if (typeof message.content !== "string") continue;
        if (message.role === "learner" && message.kind === "answer") {
          history.push({ role: "learner", content: message.content });
        } else if (
          message.role === "tutor" &&
          (message.kind === "question" || message.kind === "feedback")
        ) {
          history.push({ role: "assistant", content: message.content });
        }
      }
      const context = Schema.decodeUnknownEither(TutorContextSchema)({
        knowledgeArea: session.right.area_snapshot,
        history: selectTutorContextHistory(history),
      });
      return Either.isLeft(context)
        ? { _tag: "TutorSessionRepositoryUnavailable" }
        : {
            session: session.right,
            context: context.right,
            pendingQuestion:
              messages.right[0]?.role === "tutor" && messages.right[0].kind === "question",
          };
    },
    catch: () => ({ _tag: "TutorSessionRepositoryUnavailable" }) as const,
  }).pipe(
    Effect.flatMap((result) => ("_tag" in result ? Effect.fail(result) : Effect.succeed(result))),
  );
}
