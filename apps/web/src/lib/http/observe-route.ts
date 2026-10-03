import "server-only";

import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { recordHttpTelemetry, type HttpTelemetrySink } from "@recall/application";
import type { HttpOperation } from "@recall/contracts";
import { privateJson } from "./private-json";

const operationalLog: HttpTelemetrySink = {
  record: (event) =>
    process.env.RECALL_HTTP_LOGGING === "true"
      ? Effect.try({
          try: () => console.info(JSON.stringify(event)),
          catch: () => ({ _tag: "HttpTelemetryDeliveryFailed" }) as const,
        })
      : Effect.void,
};

/** Preserve route arguments and headers; unexpected failures produce a sanitized private response. */
export function observeRoute<A extends readonly unknown[]>(
  operation: HttpOperation,
  handler: (...arguments_: A) => Promise<Response>,
): (...arguments_: A) => Promise<Response> {
  return (...arguments_) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    return Effect.runPromise(
      Effect.tryPromise({
        try: () => handler(...arguments_),
        catch: () => ({ _tag: "UnexpectedHttpFailure" }) as const,
      }).pipe(
        Effect.match({
          onSuccess: (response) => ({ response, unexpectedFailure: false }),
          onFailure: () => ({
            response: privateJson({ error: "request-failed", requestId }, { status: 500 }),
            unexpectedFailure: true,
          }),
        }),
        Effect.flatMap(({ response, unexpectedFailure }) => {
          response.headers.set("x-request-id", requestId);
          return recordHttpTelemetry(
            {
              schemaVersion: 1,
              requestId,
              operation,
              status: response.status,
              durationMs: Math.max(0, Date.now() - startedAt),
              timestamp: new Date().toISOString(),
              unexpectedFailure,
            },
            operationalLog,
          ).pipe(Effect.ignore, Effect.as(response));
        }),
      ),
    );
  };
}
