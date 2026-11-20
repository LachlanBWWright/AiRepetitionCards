import type { ActivityResponse } from "@recall/domain";
import { Either, Schema } from "effect";

const matches = Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.String }));
export function readMatchingResponse(response: ActivityResponse): Readonly<Record<string, string>> {
  const decoded = Schema.decodeUnknownEither(matches)(response.answers[0] ?? "{}");
  return Either.isRight(decoded) ? decoded.right : {};
}
export function interactiveResponse(
  response: ActivityResponse,
  changes: Partial<Pick<ActivityResponse, "answers" | "selectedOptionIds">>,
  seed?: number,
): ActivityResponse {
  const retries = response.interaction?.retries ?? 0;
  return {
    ...response,
    ...changes,
    interaction: {
      ...response.interaction,
      ...(seed === undefined ? {} : { seed }),
      retries,
      firstTry: retries === 0,
    },
  };
}
