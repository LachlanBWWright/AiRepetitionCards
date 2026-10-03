import { HttpTelemetryEventSchema, type HttpTelemetryEvent } from "@recall/contracts";
import { Effect, Schema } from "effect";

export type HttpTelemetryFailure =
  { readonly _tag: "HttpTelemetryInvalid" } | { readonly _tag: "HttpTelemetryDeliveryFailed" };

export interface HttpTelemetrySink {
  readonly record: (
    event: HttpTelemetryEvent,
  ) => Effect.Effect<void, { readonly _tag: "HttpTelemetryDeliveryFailed" }>;
}

export function recordHttpTelemetry(
  input: unknown,
  sink: HttpTelemetrySink,
): Effect.Effect<void, HttpTelemetryFailure> {
  return Schema.decodeUnknown(HttpTelemetryEventSchema)(input).pipe(
    Effect.mapError(() => ({ _tag: "HttpTelemetryInvalid" }) as const),
    Effect.flatMap((event) => sink.record(event)),
  );
}
