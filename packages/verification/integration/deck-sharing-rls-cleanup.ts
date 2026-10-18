import { Effect, Either } from "effect";
import {
  request,
  successful,
  verify,
  type Configuration,
  type Identity,
  type IntegrationFailure,
} from "./supabase-http";

export function createDeckSharingRlsCleanup(input: {
  config: Configuration;
  admin: Identity;
  createdUsers: readonly string[];
  areaIds: readonly string[];
  publicationIds: readonly string[];
  reportIds: readonly string[];
}) {
  const { config, admin, createdUsers, areaIds, publicationIds, reportIds } = input;
  return Effect.gen(function* () {
    const results: Either.Either<unknown, IntegrationFailure>[] = [];
    if (createdUsers.length > 0) {
      results.push(
        yield* Effect.either(
          request(
            config,
            admin,
            `/rest/v1/deck_moderation_audit?actor_id=in.(${createdUsers.join(",")})`,
            { method: "DELETE" },
          ).pipe(
            Effect.flatMap((reply) => successful(reply, "Scoped moderation audit fixture cleanup")),
          ),
        ),
      );
    }
    for (const reportId of reportIds) {
      results.push(
        yield* Effect.either(
          request(config, admin, `/rest/v1/deck_reports?id=eq.${reportId}`, {
            method: "DELETE",
          }).pipe(Effect.flatMap((reply) => successful(reply, "Scoped report fixture cleanup"))),
        ),
      );
    }
    if (areaIds.length > 0) {
      for (const [table, column, label] of [
        ["deck_feedback", "deck_id", "feedback"],
        ["deck_subscriptions", "area_id", "subscriptions"],
        ["deck_update_reads", "area_id", "update read markers"],
      ] as const) {
        results.push(
          yield* Effect.either(
            request(config, admin, `/rest/v1/${table}?${column}=in.(${areaIds.join(",")})`, {
              method: "DELETE",
            }).pipe(Effect.flatMap((reply) => successful(reply, `Scoped ${label} cleanup`))),
          ),
        );
      }
    }
    if (areaIds.length > 0) {
      const deckCleanup = yield* Effect.either(
        request(config, admin, `/rest/v1/shared_decks?deck_id=in.(${areaIds.join(",")})`, {
          method: "DELETE",
        }).pipe(Effect.flatMap((reply) => successful(reply, "Scoped deck registry cleanup"))),
      );
      results.push(deckCleanup);
    }
    for (const publicationId of publicationIds) {
      results.push(
        yield* Effect.either(
          request(
            config,
            admin,
            `/rest/v1/published_knowledge_area_versions?id=eq.${publicationId}`,
            { method: "DELETE" },
          ).pipe(Effect.flatMap((reply) => successful(reply, "Scoped deck version cleanup"))),
        ),
      );
    }
    for (const userId of createdUsers) {
      results.push(
        yield* Effect.either(
          request(config, admin, "/rest/v1/rpc/erase_account_data", {
            method: "POST",
            body: { p_user_id: userId },
          }).pipe(
            Effect.flatMap((reply) => successful(reply, "Deck fixture account cleanup")),
            Effect.flatMap(() =>
              request(config, admin, `/auth/v1/admin/users/${userId}`, { method: "DELETE" }),
            ),
            Effect.flatMap((reply) => successful(reply, "Deck fixture Auth cleanup")),
          ),
        ),
      );
    }
    const cleanupFailures = results
      .filter(Either.isLeft)
      .map((result) => (Either.isLeft(result) ? result.left : null))
      .map((error) =>
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : "unknown scoped cleanup failure",
      );
    yield* verify(
      cleanupFailures.length === 0,
      `Deck-sharing fixture cleanup did not fully complete: ${cleanupFailures.join("; ")}`,
    );
  });
}
