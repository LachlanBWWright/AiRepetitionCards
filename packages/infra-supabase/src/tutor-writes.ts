import { Effect, Schema } from "effect";
import {
  CardProposalSchema,
  TutorProposalResolution,
  cardIdForTutorProposal,
} from "@recall/ai-core";
import type { RecallSupabaseClient } from "./client";
import type { Database, Json } from "./database.types";

export type TutorWriteError = { readonly _tag: "TutorWriteUnavailable" };
type Tables = Database["public"]["Tables"];
type SessionInsert = Tables["tutor_sessions"]["Insert"];
type MessageInsert = Tables["tutor_messages"]["Insert"];
type ObservationInsert = Tables["ai_observations"]["Insert"];
type ProposalInsert = Tables["generated_card_proposals"]["Insert"];
type SessionUpdate = Tables["tutor_sessions"]["Update"];

function write<T>(
  operation: () => PromiseLike<T>,
  success: (result: T) => boolean,
): Effect.Effect<void, TutorWriteError> {
  return Effect.tryPromise({
    try: operation,
    catch: () => ({ _tag: "TutorWriteUnavailable" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      success(result) ? Effect.void : Effect.fail({ _tag: "TutorWriteUnavailable" } as const),
    ),
  );
}

/** Reserve a user's daily tutor quota before calling the provider. */
export function reserveTutorCall(
  client: RecallSupabaseClient,
  id: string,
  operation: string,
  model: string,
): Effect.Effect<boolean, TutorWriteError> {
  return Effect.tryPromise({
    try: () =>
      client.rpc("reserve_tutor_ai_call", { p_id: id, p_operation: operation, p_model: model }),
    catch: () => ({ _tag: "TutorWriteUnavailable" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result.error === null
        ? Effect.succeed(result.data)
        : Effect.fail({ _tag: "TutorWriteUnavailable" } as const),
    ),
  );
}

/** Record provider token usage for a previously reserved call. */
export function recordTutorUsage(
  client: RecallSupabaseClient,
  id: string,
  inputTokens: number,
  outputTokens: number,
): Effect.Effect<void, TutorWriteError> {
  return write(
    () =>
      client.rpc("record_tutor_ai_usage", {
        p_id: id,
        p_input_tokens: inputTokens,
        p_output_tokens: outputTokens,
      }),
    (result) => result.error === null && result.data,
  );
}

/** Create a session owned by the authenticated user. */
export function createTutorSession(
  client: RecallSupabaseClient,
  userId: string,
  session: Omit<SessionInsert, "user_id">,
): Effect.Effect<void, TutorWriteError> {
  return write(
    () => client.from("tutor_sessions").insert({ ...session, user_id: userId }),
    (result) => result.error === null,
  );
}

/** Append an owner-scoped, immutable tutor history message. */
export function appendTutorMessage(
  client: RecallSupabaseClient,
  userId: string,
  message: Omit<MessageInsert, "user_id">,
): Effect.Effect<void, TutorWriteError> {
  return write(
    () => client.from("tutor_messages").insert({ ...message, user_id: userId }),
    (result) => result.error === null,
  );
}

/** Append an owner-scoped validated tutor observation. */
export function appendTutorObservation(
  client: RecallSupabaseClient,
  userId: string,
  observation: Omit<ObservationInsert, "user_id">,
): Effect.Effect<void, TutorWriteError> {
  return write(
    () => client.from("ai_observations").insert({ ...observation, user_id: userId }),
    (result) => result.error === null,
  );
}

/** Append an owner-scoped proposal that remains pending until the user resolves it. */
export function appendTutorProposal(
  client: RecallSupabaseClient,
  userId: string,
  proposal: Omit<ProposalInsert, "user_id">,
): Effect.Effect<void, TutorWriteError> {
  return write(
    () => client.from("generated_card_proposals").insert({ ...proposal, user_id: userId }),
    (result) => result.error === null,
  );
}

/** Update only a session owned by the authenticated user. */
export function updateTutorSession(
  client: RecallSupabaseClient,
  userId: string,
  sessionId: string,
  update: SessionUpdate,
): Effect.Effect<void, TutorWriteError> {
  return write(
    () => client.from("tutor_sessions").update(update).eq("id", sessionId).eq("user_id", userId),
    (result) => result.error === null,
  );
}

/** Resolve a pending proposal through the RLS protected user client. */
export function resolveTutorProposal(
  client: RecallSupabaseClient,
  proposalId: string,
  state: TutorProposalResolution,
  content?: Exclude<Json, null>,
  cardId?: string,
): Effect.Effect<boolean, TutorWriteError> {
  return Effect.tryPromise({
    try: () =>
      client.rpc("resolve_card_proposal", {
        p_proposal_id: proposalId,
        p_state: state,
        ...(content === undefined ? {} : { p_content: content }),
        ...(cardId === undefined ? {} : { p_card_id: cardId }),
      }),
    catch: () => ({ _tag: "TutorWriteUnavailable" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result.error === null
        ? Effect.succeed(result.data)
        : Effect.fail({ _tag: "TutorWriteUnavailable" } as const),
    ),
  );
}

const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
const ApprovedProposalRowSchema = Schema.Struct({
  id: UuidSchema,
  session_id: UuidSchema,
  approved_card_id: UuidSchema,
  approved_revision_id: Schema.NullOr(UuidSchema),
  content: CardProposalSchema,
  state: Schema.Literal("approved"),
});
const ApprovedRevisionSchema = Schema.Struct({
  id: UuidSchema,
  content: Schema.Struct({
    id: UuidSchema,
    kind: Schema.Literal("basic"),
    origin: Schema.Literal("ai-generated"),
    sourceId: Schema.String,
    front: Schema.String,
    back: Schema.String,
    objectiveIds: Schema.Array(Schema.String),
  }),
});

function readApprovalRow<A, I>(
  schema: Schema.Schema<A, I>,
  operation: () => PromiseLike<{ readonly data: unknown; readonly error: unknown }>,
): Effect.Effect<A, TutorWriteError> {
  return Effect.tryPromise({
    try: operation,
    catch: () => ({ _tag: "TutorWriteUnavailable" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result.error === null
        ? Schema.decodeUnknown(schema)(result.data).pipe(
            Effect.mapError(() => ({ _tag: "TutorWriteUnavailable" }) as const),
          )
        : Effect.fail({ _tag: "TutorWriteUnavailable" } as const),
    ),
  );
}

/** Repair the sync-before-approval ordering using verified ownership and immutable content.
 * Later sync remains covered by the existing revision insert trigger. */
export function linkExistingTutorApprovalRevision(
  client: RecallSupabaseClient,
  admin: RecallSupabaseClient | null,
  userId: string,
  proposalId: string,
): Effect.Effect<void, TutorWriteError> {
  return Effect.gen(function* () {
    const proposal = yield* readApprovalRow(ApprovedProposalRowSchema, () =>
      client
        .from("generated_card_proposals")
        .select("id, session_id, approved_card_id, approved_revision_id, content, state")
        .eq("id", proposalId)
        .eq("user_id", userId)
        .eq("state", "approved")
        .single(),
    );
    if (cardIdForTutorProposal(proposal.id) !== proposal.approved_card_id)
      return yield* Effect.fail({ _tag: "TutorWriteUnavailable" } as const);
    const session = yield* readApprovalRow(Schema.Struct({ area_id: UuidSchema }), () =>
      client
        .from("tutor_sessions")
        .select("area_id")
        .eq("id", proposal.session_id)
        .eq("user_id", userId)
        .single(),
    );
    yield* readApprovalRow(Schema.Struct({ id: UuidSchema }), () =>
      client
        .from("knowledge_areas")
        .select("id")
        .eq("id", session.area_id)
        .eq("owner_id", userId)
        .single(),
    );
    const card = yield* readApprovalRow(Schema.NullOr(Schema.Struct({ id: UuidSchema })), () =>
      client
        .from("cards")
        .select("id")
        .eq("id", proposal.approved_card_id)
        .eq("knowledge_area_id", session.area_id)
        .maybeSingle(),
    );
    // No server card yet: its first revision will link after this resolution.
    if (card === null && proposal.approved_revision_id === null) return;
    if (card === null) return yield* Effect.fail({ _tag: "TutorWriteUnavailable" } as const);
    const sourceId = `tutor:${proposal.session_id}:${proposal.id}`;
    const revision = yield* readApprovalRow(Schema.NullOr(ApprovedRevisionSchema), () => {
      let query = client
        .from("card_revisions")
        .select("id, content")
        .eq("card_id", card.id)
        .eq("created_by", userId)
        .eq("creator_type", "ai")
        .eq("content->>id", card.id)
        .eq("content->>kind", "basic")
        .eq("content->>origin", "ai-generated")
        .eq("content->>sourceId", sourceId)
        .eq("content->>front", proposal.content.front)
        .eq("content->>back", proposal.content.back)
        .eq(
          "content->objectiveIds",
          JSON.stringify(
            proposal.content.objectiveId === null ? [] : [proposal.content.objectiveId],
          ),
        );
      if (proposal.approved_revision_id !== null)
        query = query.eq("id", proposal.approved_revision_id);
      return query.order("revision", { ascending: true }).limit(1).maybeSingle();
    });
    if (revision === null && proposal.approved_revision_id === null) {
      const existing = yield* readApprovalRow(
        Schema.NullOr(Schema.Struct({ id: UuidSchema })),
        () =>
          client
            .from("card_revisions")
            .select("id")
            .eq("card_id", card.id)
            .order("revision", { ascending: true })
            .limit(1)
            .maybeSingle(),
      );
      if (existing === null) return;
    }
    if (
      revision === null ||
      revision.content.objectiveIds.length !== (proposal.content.objectiveId === null ? 0 : 1) ||
      (proposal.content.objectiveId !== null &&
        revision.content.objectiveIds[0] !== proposal.content.objectiveId)
    )
      return yield* Effect.fail({ _tag: "TutorWriteUnavailable" } as const);
    if (proposal.approved_revision_id !== null) return;
    if (admin === null) return yield* Effect.fail({ _tag: "TutorWriteUnavailable" } as const);
    const updated = yield* readApprovalRow(
      Schema.Array(Schema.Struct({ approved_revision_id: UuidSchema })).pipe(Schema.maxItems(1)),
      () =>
        admin
          .from("generated_card_proposals")
          .update({ approved_revision_id: revision.id })
          .eq("id", proposal.id)
          .eq("user_id", userId)
          .eq("session_id", proposal.session_id)
          .eq("state", "approved")
          .eq("approved_card_id", card.id)
          .is("approved_revision_id", null)
          .select("approved_revision_id"),
    );
    if (updated.length === 1) return;
    // A concurrent trigger/approval may have completed the same compare-and-set.
    const persisted = yield* readApprovalRow(
      Schema.Struct({ approved_revision_id: UuidSchema }),
      () =>
        client
          .from("generated_card_proposals")
          .select("approved_revision_id")
          .eq("id", proposal.id)
          .eq("user_id", userId)
          .eq("state", "approved")
          .eq("approved_card_id", card.id)
          .single(),
    );
    if (persisted.approved_revision_id !== revision.id)
      return yield* Effect.fail({ _tag: "TutorWriteUnavailable" } as const);
  });
}

const MAX_APPROVAL_REPAIRS_PER_RESTORE = 100;

/** Recover an approval acknowledged by the RPC before its linkage repair completed.
 * Bound both reads and sequential writes to the requested owner's session. */
export function repairTutorSessionApprovalRevisions(
  client: RecallSupabaseClient,
  admin: RecallSupabaseClient | null,
  userId: string,
  sessionId: string,
): Effect.Effect<void, TutorWriteError> {
  return Effect.gen(function* () {
    const proposals = yield* readApprovalRow(
      Schema.Array(Schema.Struct({ id: UuidSchema, session_id: UuidSchema })).pipe(
        Schema.maxItems(MAX_APPROVAL_REPAIRS_PER_RESTORE + 1),
      ),
      () =>
        client
          .from("generated_card_proposals")
          .select("id, session_id")
          .eq("user_id", userId)
          .eq("session_id", sessionId)
          .eq("state", "approved")
          .is("approved_revision_id", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(MAX_APPROVAL_REPAIRS_PER_RESTORE + 1),
    );
    for (const proposal of proposals.slice(0, MAX_APPROVAL_REPAIRS_PER_RESTORE)) {
      if (proposal.session_id !== sessionId)
        return yield* Effect.fail({ _tag: "TutorWriteUnavailable" } as const);
      yield* linkExistingTutorApprovalRevision(client, admin, userId, proposal.id);
    }
    // Successful repairs are durable, so another restore can advance the backlog.
    // Unsynced cards remain eligible for the existing trigger; don't silently hide overflow.
    if (proposals.length > MAX_APPROVAL_REPAIRS_PER_RESTORE)
      return yield* Effect.fail({ _tag: "TutorWriteUnavailable" } as const);
  });
}
