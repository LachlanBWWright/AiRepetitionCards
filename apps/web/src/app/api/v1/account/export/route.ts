import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";

type Page<A> = {
  readonly data: ReadonlyArray<A> | null;
  readonly error: unknown;
};

async function readAllPages<A>(
  read: (from: number, to: number) => PromiseLike<Page<A>>,
): Promise<ReadonlyArray<A> | null> {
  const pageSize = 1000;
  const rows: Array<A> = [];
  for (let from = 0; ; from += pageSize) {
    const result = await read(from, from + pageSize - 1);
    if (result.error || !result.data) return null;
    rows.push(...result.data);
    if (result.data.length < pageSize) return rows;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status =
      auth.reason === "not-configured" ? 503 : auth.reason === "unauthenticated" ? 401 : 502;
    return NextResponse.json({ error: auth.reason }, { status });
  }

  const { client, userId } = auth;
  const readOwned = <A>(
    table:
      | "review_events"
      | "scheduling_state"
      | "sync_changes"
      | "tutor_sessions"
      | "tutor_messages"
      | "ai_observations"
      | "generated_card_proposals"
      | "tutor_ai_usage_events",
  ) => {
    const orderColumn = {
      review_events: "id",
      scheduling_state: "card_id",
      sync_changes: "sequence",
      tutor_sessions: "id",
      tutor_messages: "id",
      ai_observations: "id",
      generated_card_proposals: "id",
      tutor_ai_usage_events: "id",
    }[table];
    return readAllPages<A>((from, to) =>
      client
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .order(orderColumn, { ascending: true })
        .range(from, to),
    );
  };

  const [
    profileResult,
    areaResult,
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
        .order("user_id", { ascending: true })
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("knowledge_areas")
        .select("*")
        .eq("owner_id", userId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    readOwned("review_events"),
    readOwned("scheduling_state"),
    readOwned("sync_changes"),
    readOwned("tutor_sessions"),
    readOwned("tutor_messages"),
    readOwned("ai_observations"),
    readOwned("generated_card_proposals"),
    readOwned("tutor_ai_usage_events"),
  ]);
  if (
    !profileResult ||
    !areaResult ||
    !reviewEvents ||
    !schedules ||
    !syncChanges ||
    !sessions ||
    !messages ||
    !observations ||
    !proposals ||
    !usage
  ) {
    return NextResponse.json({ error: "account-export-unavailable" }, { status: 502 });
  }
  const areaIds = areaResult.map((area) => area.id);
  const cardIds = areaIds.length
    ? await readAllPages((from, to) =>
        client
          .from("cards")
          .select("*")
          .in("knowledge_area_id", areaIds)
          .order("id", { ascending: true })
          .range(from, to),
      )
    : [];
  const [areaVersions, objectives, prerequisites] = areaIds.length
    ? await Promise.all([
        readAllPages((from, to) =>
          client
            .from("knowledge_area_versions")
            .select("*")
            .in("knowledge_area_id", areaIds)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("learning_objectives")
            .select("*")
            .in("knowledge_area_id", areaIds)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("objective_prerequisites")
            .select("*")
            .in("knowledge_area_id", areaIds)
            .order("objective_id", { ascending: true })
            .range(from, to),
        ),
      ])
    : [[], [], []];
  const syncedCards = cardIds?.map((card) => card.id) ?? [];
  const [cardRevisions, cardObjectives] = syncedCards.length
    ? await Promise.all([
        readAllPages((from, to) =>
          client
            .from("card_revisions")
            .select("*")
            .in("card_id", syncedCards)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        readAllPages((from, to) =>
          client
            .from("card_objectives")
            .select("*")
            .in("card_id", syncedCards)
            .order("card_id", { ascending: true })
            .range(from, to),
        ),
      ])
    : [[], []];

  const data = [areaVersions, objectives, prerequisites, cardIds, cardRevisions, cardObjectives];
  if (data.some((collection) => !collection))
    return NextResponse.json({ error: "account-export-unavailable" }, { status: 502 });

  const date = new Date().toISOString().slice(0, 10);
  const exportData = {
    format: "recall-account-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    account: { userId, profile: profileResult[0] ?? null },
    data: {
      knowledgeAreas: areaResult,
      knowledgeAreaVersions: areaVersions,
      learningObjectives: objectives,
      objectivePrerequisites: prerequisites,
      cards: cardIds,
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
  };
  return new NextResponse(JSON.stringify(exportData), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="recall-account-export-${date}.json"`,
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
