import { Effect, Either, Schema } from "effect";
import {
  DeckDetailResponseSchema,
  DeckDifficultySchema,
  DeckListResponseSchema,
  DeckMetadataPatchSchema,
  DeckMetadataResponseSchema,
  DeckSubscriptionUpdateReadRequestSchema,
  DeckSubscriptionUpdatesResponseSchema,
  DeckSubscriptionRequestSchema,
  DeckSubscriptionsResponseSchema,
  type DeckSummary,
  type DeckVersionSummary,
  type DeckSubscription,
  type DeckFeedback,
} from "@recall/contracts";
import { createDeckSharingTrustApi } from "./deck-sharing-api-trust";

export type DeckSharingHttpRequest = {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
};
export type DeckSharingHttpResponse = { readonly status: number; readonly body: unknown };
export type DeckSharingTransportFailure = { readonly _tag: "DeckSharingTransportFailure" };
export type DeckSharingTransport = (
  request: DeckSharingHttpRequest,
) => Effect.Effect<DeckSharingHttpResponse, DeckSharingTransportFailure>;
export type DeckSharingFailure =
  | DeckSharingTransportFailure
  | {
      readonly _tag: "DeckSharingApiFailure";
      readonly reason: "invalid-request" | "invalid-response";
    }
  | { readonly _tag: "DeckSharingApiFailure"; readonly reason: "http"; readonly status: number };

function hasSubscription(
  response: { readonly subscriptions: readonly DeckSubscription[] },
  expected: {
    readonly deckId: string;
    readonly areaId: string;
    readonly versionId: string;
    readonly following: boolean;
  },
): boolean {
  return response.subscriptions.some(
    (item) =>
      item.deckId === expected.deckId &&
      item.areaId === expected.areaId &&
      item.versionId === expected.versionId &&
      item.following === expected.following,
  );
}

function hasReadSubscriptionUpdate(
  response: {
    readonly updates: readonly {
      readonly areaId: string;
      readonly latestVersionId: string;
      readonly seen: boolean;
    }[];
  },
  areaId: string,
  versionId: string,
): boolean {
  return response.updates.some(
    (item) =>
      item.areaId.toLowerCase() === areaId.toLowerCase() &&
      item.latestVersionId.toLowerCase() === versionId.toLowerCase() &&
      item.seen,
  );
}

function decode<A, I>(
  response: DeckSharingHttpResponse,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, DeckSharingFailure> {
  if (response.status < 200 || response.status >= 300)
    return Effect.fail({ _tag: "DeckSharingApiFailure", reason: "http", status: response.status });
  const result = Schema.decodeUnknownEither(schema, { onExcessProperty: "error" })(response.body);
  if (Either.isLeft(result))
    return Effect.fail({ _tag: "DeckSharingApiFailure", reason: "invalid-response" });
  const value: unknown = result.right;
  const hasUniqueStringKey = (items: readonly unknown[], key: string): boolean => {
    const keys = new Set<string>();
    for (const item of items) {
      if (typeof item !== "object" || item === null || !(key in item)) return false;
      const itemKey = (item as Record<string, unknown>)[key];
      if (typeof itemKey !== "string" || keys.has(itemKey)) return false;
      keys.add(itemKey);
    }
    return true;
  };
  if (
    typeof value === "object" &&
    value !== null &&
    "decks" in value &&
    Array.isArray(value.decks) &&
    !hasUniqueStringKey(value.decks, "id")
  )
    return Effect.fail({ _tag: "DeckSharingApiFailure", reason: "invalid-response" });
  if (
    typeof value === "object" &&
    value !== null &&
    "updates" in value &&
    Array.isArray(value.updates) &&
    !hasUniqueStringKey(value.updates, "areaId")
  )
    return Effect.fail({ _tag: "DeckSharingApiFailure", reason: "invalid-response" });
  if (
    typeof value === "object" &&
    value !== null &&
    "subscriptions" in value &&
    Array.isArray(value.subscriptions) &&
    !hasUniqueStringKey(value.subscriptions, "areaId")
  )
    return Effect.fail({ _tag: "DeckSharingApiFailure", reason: "invalid-response" });
  if (
    typeof value === "object" &&
    value !== null &&
    "feedback" in value &&
    Array.isArray(value.feedback) &&
    !hasUniqueStringKey(value.feedback, "id")
  )
    return Effect.fail({ _tag: "DeckSharingApiFailure", reason: "invalid-response" });
  return Effect.succeed(result.right);
}
const invalidRequest = () =>
  Effect.fail({ _tag: "DeckSharingApiFailure", reason: "invalid-request" } as const);
const encode = <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
  Schema.decodeUnknownEither(schema, { onExcessProperty: "error" })(input);
const Uuid = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);

export function createDeckSharingApi(transport: DeckSharingTransport) {
  const call = <A, I>(
    method: DeckSharingHttpRequest["method"],
    path: string,
    schema: Schema.Schema<A, I>,
    body?: unknown,
  ) =>
    Effect.suspend(() =>
      transport({ method, path, ...(body === undefined ? {} : { body }) }).pipe(
        Effect.flatMap((response) => decode(response, schema)),
      ),
    );
  const get = <A, I>(path: string, schema: Schema.Schema<A, I>) => call("GET", path, schema);
  const send = <A, I>(
    method: DeckSharingHttpRequest["method"],
    path: string,
    body: unknown,
    schema: Schema.Schema<A, I>,
  ) => call(method, path, schema, body);
  const validId = (input: unknown) => encode(Uuid, input);
  const routeId = (input: unknown) => validId(input);
  const query = (values: Readonly<Record<string, string | number | undefined>>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined && value !== "") params.set(key, String(value));
    const suffix = params.toString();
    return suffix ? `?${suffix}` : "";
  };
  return {
    discover(input: unknown) {
      const decoded = encode(
        Schema.Struct({
          q: Schema.optional(Schema.String),
          language: Schema.optional(Schema.String),
          tag: Schema.optional(Schema.String),
          difficulty: Schema.optional(DeckDifficultySchema),
          activityType: Schema.optional(
            Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
          ),
          minMinutes: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 1000))),
          maxMinutes: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 1000))),
          limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 50))),
          cursor: Schema.optional(Uuid),
        }),
        input,
      );
      if (
        Either.isLeft(decoded) ||
        (decoded.right.minMinutes !== undefined &&
          decoded.right.maxMinutes !== undefined &&
          decoded.right.minMinutes > decoded.right.maxMinutes)
      )
        return invalidRequest();
      return get(`/api/v1/decks${query(decoded.right)}`, DeckListResponseSchema);
    },
    listMine(input: unknown = {}) {
      const decoded = encode(
        Schema.Struct({
          limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 50))),
          cursor: Schema.optional(Uuid),
        }),
        input,
      );
      if (Either.isLeft(decoded)) return invalidRequest();
      return get(`/api/v1/decks/mine${query(decoded.right)}`, DeckListResponseSchema);
    },
    read(deckId: unknown, token?: unknown) {
      const req = encode(Schema.Struct({ deckId: Uuid, token: Schema.optional(Schema.String) }), {
        deckId,
        ...(token === undefined ? {} : { token }),
      });
      if (Either.isLeft(req)) return invalidRequest();
      return get(
        `/api/v1/decks/${req.right.deckId.toLowerCase()}${query({ token: req.right.token })}`,
        DeckDetailResponseSchema,
      ).pipe(
        Effect.filterOrFail(
          (response) => response.deck.id.toLowerCase() === req.right.deckId.toLowerCase(),
          () => ({ _tag: "DeckSharingApiFailure", reason: "invalid-response" }) as const,
        ),
      );
    },
    updateDeck(deckId: unknown, patch: unknown) {
      const id = validId(deckId);
      const body = encode(DeckMetadataPatchSchema, patch);
      if (Either.isLeft(id) || Either.isLeft(body)) return invalidRequest();
      return send(
        "PATCH",
        `/api/v1/decks/${id.right.toLowerCase()}`,
        body.right,
        DeckMetadataResponseSchema,
      ).pipe(
        Effect.filterOrFail(
          (response) => response.deck.id.toLowerCase() === id.right.toLowerCase(),
          () => ({ _tag: "DeckSharingApiFailure", reason: "invalid-response" }) as const,
        ),
      );
    },
    listSubscriptions() {
      return get("/api/v1/deck-subscriptions", DeckSubscriptionsResponseSchema);
    },
    putSubscription(input: unknown) {
      const body = encode(DeckSubscriptionRequestSchema, input);
      return Either.isLeft(body)
        ? invalidRequest()
        : send(
            "PUT",
            "/api/v1/deck-subscriptions",
            body.right,
            DeckSubscriptionsResponseSchema,
          ).pipe(
            Effect.filterOrFail(
              (response) => hasSubscription(response, body.right),
              () => ({ _tag: "DeckSharingApiFailure", reason: "invalid-response" }) as const,
            ),
          );
    },
    deleteSubscription(areaId: unknown) {
      const id = routeId(areaId);
      return Either.isLeft(id)
        ? invalidRequest()
        : call(
            "DELETE",
            `/api/v1/deck-subscriptions/${id.right}`,
            DeckSubscriptionsResponseSchema,
          ).pipe(
            Effect.filterOrFail(
              (response) => !response.subscriptions.some((item) => item.areaId === id.right),
              () => ({ _tag: "DeckSharingApiFailure", reason: "invalid-response" }) as const,
            ),
          );
    },
    listSubscriptionUpdates() {
      return get("/api/v1/deck-subscriptions/updates", DeckSubscriptionUpdatesResponseSchema);
    },
    markSubscriptionUpdateRead(areaId: unknown, versionId: unknown) {
      const id = routeId(areaId);
      const body = encode(DeckSubscriptionUpdateReadRequestSchema, { versionId });
      return Either.isLeft(id) || Either.isLeft(body)
        ? invalidRequest()
        : send(
            "POST",
            `/api/v1/deck-subscriptions/${id.right}/updates/read`,
            body.right,
            DeckSubscriptionUpdatesResponseSchema,
          ).pipe(
            Effect.filterOrFail(
              (response) => hasReadSubscriptionUpdate(response, id.right, body.right.versionId),
              () => ({ _tag: "DeckSharingApiFailure", reason: "invalid-response" }) as const,
            ),
          );
    },
    ...createDeckSharingTrustApi({ call, get, send, routeId, encode, invalidRequest }),
  };
}

export type DeckSharingApi = ReturnType<typeof createDeckSharingApi>;
export type { DeckSummary, DeckVersionSummary, DeckSubscription, DeckFeedback };
