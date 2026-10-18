import { Effect, Either, Schema } from "effect";
import {
  DeckBlockResponseSchema,
  DeckFeedbackRequestSchema,
  DeckFeedbackResponseSchema,
  DeckFeedbackStatusRequestSchema,
  DeckReportRequestSchema,
  DeckReportResponseSchema,
  ModerationDeckRequestSchema,
  ModerationMutationResponseSchema,
  ModerationReportRequestSchema,
  ModerationReportsResponseSchema,
} from "@recall/contracts";
import type { ParseError } from "effect/ParseResult";
import type { DeckSharingFailure } from "./deck-sharing-api";

type ApiHelpers = {
  readonly call: <A, I>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    schema: Schema.Schema<A, I>,
    body?: unknown,
  ) => Effect.Effect<A, DeckSharingFailure>;
  readonly get: <A, I>(
    path: string,
    schema: Schema.Schema<A, I>,
  ) => Effect.Effect<A, DeckSharingFailure>;
  readonly send: <A, I>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    schema: Schema.Schema<A, I>,
  ) => Effect.Effect<A, DeckSharingFailure>;
  readonly routeId: (input: unknown) => Either.Either<string, ParseError>;
  readonly encode: <A, I>(
    schema: Schema.Schema<A, I>,
    input: unknown,
  ) => Either.Either<A, ParseError>;
  readonly invalidRequest: () => Effect.Effect<never, DeckSharingFailure>;
};

function hasFeedbackStatus(
  response: { readonly feedback: readonly { readonly id: string; readonly status: string }[] },
  feedbackId: string,
  status: string,
): boolean {
  return response.feedback.some((item) => item.id === feedbackId && item.status === status);
}

export function createDeckSharingTrustApi({
  call,
  get,
  send,
  routeId,
  encode,
  invalidRequest,
}: ApiHelpers) {
  return {
    reportDeck(deckId: unknown, input: unknown) {
      const id = routeId(deckId);
      const body = encode(DeckReportRequestSchema, input);
      return Either.isLeft(id) || Either.isLeft(body)
        ? invalidRequest()
        : send(
            "POST",
            `/api/v1/decks/${id.right}/reports`,
            body.right,
            DeckReportResponseSchema,
          ).pipe(
            Effect.filterOrFail(
              (response) => response.reportId.toLowerCase() === body.right.id.toLowerCase(),
              () => ({ _tag: "DeckSharingApiFailure", reason: "invalid-response" }) as const,
            ),
          );
    },
    blockDeck(deckId: unknown, token?: unknown) {
      const id = routeId(deckId);
      const tokenValue =
        token === undefined
          ? undefined
          : encode(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{43}$/)), token);
      return Either.isLeft(id) || (tokenValue !== undefined && Either.isLeft(tokenValue))
        ? invalidRequest()
        : call(
            "POST",
            `/api/v1/decks/${id.right}/block`,
            DeckBlockResponseSchema,
            tokenValue === undefined ? undefined : { token: tokenValue.right },
          ).pipe(
            Effect.filterOrFail(
              (response) => response.blocked,
              () => ({ _tag: "DeckSharingApiFailure", reason: "invalid-response" }) as const,
            ),
          );
    },
    unblockDeck(deckId: unknown, token?: unknown) {
      const id = routeId(deckId);
      const tokenValue =
        token === undefined
          ? undefined
          : encode(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{43}$/)), token);
      return Either.isLeft(id) || (tokenValue !== undefined && Either.isLeft(tokenValue))
        ? invalidRequest()
        : call(
            "DELETE",
            `/api/v1/decks/${id.right}/block`,
            DeckBlockResponseSchema,
            tokenValue === undefined ? undefined : { token: tokenValue.right },
          ).pipe(
            Effect.filterOrFail(
              (response) => !response.blocked,
              () => ({ _tag: "DeckSharingApiFailure", reason: "invalid-response" }) as const,
            ),
          );
    },
    listModerationReports() {
      return get("/api/v1/moderation/reports", ModerationReportsResponseSchema);
    },
    moderateDeck(deckId: unknown, input: unknown) {
      const id = routeId(deckId);
      const body = encode(ModerationDeckRequestSchema, input);
      return Either.isLeft(id) || Either.isLeft(body)
        ? invalidRequest()
        : send(
            "PATCH",
            `/api/v1/moderation/decks/${id.right}`,
            body.right,
            ModerationMutationResponseSchema,
          );
    },
    updateModerationReport(reportId: unknown, input: unknown) {
      const id = routeId(reportId);
      const body = encode(ModerationReportRequestSchema, input);
      return Either.isLeft(id) || Either.isLeft(body)
        ? invalidRequest()
        : send(
            "PATCH",
            `/api/v1/moderation/reports/${id.right}`,
            body.right,
            ModerationMutationResponseSchema,
          );
    },
    listFeedback(deckId: unknown) {
      const id = routeId(deckId);
      return Either.isLeft(id)
        ? invalidRequest()
        : get(`/api/v1/decks/${id.right}/feedback`, DeckFeedbackResponseSchema);
    },
    submitFeedback(deckId: unknown, input: unknown) {
      const id = routeId(deckId);
      const body = encode(DeckFeedbackRequestSchema, input);
      return Either.isLeft(id) || Either.isLeft(body)
        ? invalidRequest()
        : send(
            "POST",
            `/api/v1/decks/${id.right}/feedback`,
            body.right,
            DeckFeedbackResponseSchema,
          ).pipe(
            Effect.filterOrFail(
              (response) => response.feedback.some((item) => item.id === body.right.id),
              () => ({ _tag: "DeckSharingApiFailure", reason: "invalid-response" }) as const,
            ),
          );
    },
    updateFeedback(deckId: unknown, feedbackId: unknown, input: unknown) {
      const id = routeId(deckId);
      const fid = routeId(feedbackId);
      const body = encode(DeckFeedbackStatusRequestSchema, input);
      return Either.isLeft(id) || Either.isLeft(fid) || Either.isLeft(body)
        ? invalidRequest()
        : send(
            "PATCH",
            `/api/v1/decks/${id.right}/feedback/${fid.right}`,
            body.right,
            DeckFeedbackResponseSchema,
          ).pipe(
            Effect.filterOrFail(
              (response) => hasFeedbackStatus(response, fid.right, body.right.status),
              () => ({ _tag: "DeckSharingApiFailure", reason: "invalid-response" }) as const,
            ),
          );
    },
  };
}
