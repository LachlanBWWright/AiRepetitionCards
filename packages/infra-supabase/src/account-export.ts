import { Effect, Either, Schema } from "effect";
import type { RecallSupabaseClient } from "./client";

export type AccountExportReadError = { readonly _tag: "AccountExportReadError" };

type Page = { readonly data: unknown; readonly error: unknown };

async function readAllPages(
  read: (from: number, to: number) => PromiseLike<Page>,
): Promise<ReadonlyArray<unknown> | null> {
  const pageSize = 1000;
  const rows: Array<unknown> = [];
  for (let from = 0; ; from += pageSize) {
    const result = await read(from, from + pageSize - 1);
    if (result.error !== null) return null;
    const page = Schema.decodeUnknownEither(Schema.Array(Schema.Unknown))(result.data);
    if (Either.isLeft(page)) return null;
    rows.push(...page.right);
    if (page.right.length < pageSize) return rows;
  }
}

function isComplete<T extends ReadonlyArray<unknown>>(
  values: ReadonlyArray<T | null>,
): values is ReadonlyArray<T> {
  return values.every((value) => value !== null);
}

/** Read the owner-scoped rows needed to assemble a complete account export. */
export function readAccountExportRows(
  client: RecallSupabaseClient,
  userId: string,
): Effect.Effect<unknown, AccountExportReadError> {
  const operation = Effect.tryPromise({
    try: async () => {
      const [
        profiles,
        areas,
        reviewEvents,
        schedules,
        syncChanges,
        sessions,
        messages,
        observations,
        proposals,
        usage,
      ] = await Promise.all([
        readAllPages((from, to) =>
          client
            .from("profiles")
            .select("*")
            .eq("user_id", userId)
            .order("user_id")
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("knowledge_areas")
            .select("*")
            .eq("owner_id", userId)
            .order("id")
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("review_events")
            .select("*")
            .eq("user_id", userId)
            .order("id")
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("scheduling_state")
            .select("*")
            .eq("user_id", userId)
            .order("card_id")
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("sync_changes")
            .select("*")
            .eq("user_id", userId)
            .order("sequence")
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("tutor_sessions")
            .select("*")
            .eq("user_id", userId)
            .order("id")
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("tutor_messages")
            .select("*")
            .eq("user_id", userId)
            .order("id")
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("ai_observations")
            .select("*")
            .eq("user_id", userId)
            .order("id")
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("generated_card_proposals")
            .select("*")
            .eq("user_id", userId)
            .order("id")
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("tutor_ai_usage_events")
            .select("*")
            .eq("user_id", userId)
            .order("id")
            .range(from, to),
        ),
      ]);
      const ownerRows = [
        profiles,
        areas,
        reviewEvents,
        schedules,
        syncChanges,
        sessions,
        messages,
        observations,
        proposals,
        usage,
      ];
      if (!isComplete(ownerRows)) return { _tag: "ReadFailure" } as const;

      const areaIdentity = Schema.decodeUnknownEither(
        Schema.Array(Schema.Struct({ id: Schema.String })),
      )(areas);
      if (Either.isLeft(areaIdentity)) return { _tag: "ReadFailure" } as const;
      const areaIds = areaIdentity.right.map((area) => area.id);
      const [cards, areaVersions, objectives, prerequisites] = areaIds.length
        ? await Promise.all([
            readAllPages((from, to) =>
              client
                .from("cards")
                .select("*")
                .in("knowledge_area_id", areaIds)
                .order("id")
                .range(from, to),
            ),
            readAllPages((from, to) =>
              client
                .from("knowledge_area_versions")
                .select("*")
                .in("knowledge_area_id", areaIds)
                .order("id")
                .range(from, to),
            ),
            readAllPages((from, to) =>
              client
                .from("learning_objectives")
                .select("*")
                .in("knowledge_area_id", areaIds)
                .order("id")
                .range(from, to),
            ),
            readAllPages((from, to) =>
              client
                .from("objective_prerequisites")
                .select("*")
                .in("knowledge_area_id", areaIds)
                .order("objective_id")
                .range(from, to),
            ),
          ])
        : [[], [], [], []];
      if (!isComplete([cards, areaVersions, objectives, prerequisites]))
        return { _tag: "ReadFailure" } as const;

      const cardIdentity = Schema.decodeUnknownEither(
        Schema.Array(Schema.Struct({ id: Schema.String })),
      )(cards);
      if (Either.isLeft(cardIdentity)) return { _tag: "ReadFailure" } as const;
      const cardIds = cardIdentity.right.map((card) => card.id);
      const [cardRevisions, cardObjectives] = cardIds.length
        ? await Promise.all([
            readAllPages((from, to) =>
              client
                .from("card_revisions")
                .select("*")
                .in("card_id", cardIds)
                .order("id")
                .range(from, to),
            ),
            readAllPages((from, to) =>
              client
                .from("card_objectives")
                .select("*")
                .in("card_id", cardIds)
                .order("card_id")
                .range(from, to),
            ),
          ])
        : [[], []];
      if (!isComplete([cardRevisions, cardObjectives])) return { _tag: "ReadFailure" } as const;
      const profileRows = Schema.decodeUnknownEither(Schema.Array(Schema.Unknown))(profiles);
      if (Either.isLeft(profileRows)) return { _tag: "ReadFailure" } as const;

      return {
        _tag: "ReadSuccess",
        data: {
          profile: profileRows.right[0] ?? null,
          data: {
            knowledgeAreas: areas,
            knowledgeAreaVersions: areaVersions,
            learningObjectives: objectives,
            objectivePrerequisites: prerequisites,
            cards,
            cardRevisions,
            cardObjectives,
            reviewEvents,
            schedulingState: schedules,
            syncChanges,
            tutorSessions: sessions,
            tutorMessages: messages,
            aiObservations: observations,
            generatedCardProposals: proposals,
            aiUsage: usage,
          },
        },
      } as const;
    },
    catch: () => ({ _tag: "AccountExportReadError" }) as const,
  });
  return operation.pipe(
    Effect.flatMap((result) =>
      result._tag === "ReadSuccess"
        ? Effect.succeed(result.data)
        : Effect.fail({ _tag: "AccountExportReadError" } as const),
    ),
  );
}
